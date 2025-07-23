import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { PublicKey } from '@solana/web3.js';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { StructuredLogger } from '../../utils/structured-logger';
import { SolanaService } from '../blockchain/solana.service';
import { WalletVerificationService } from '../wallet/wallet-verification.service';
import { generateRandomString } from '../../utils/crypto';

export enum PaymentStatus {
  INITIATED = 'initiated',
  AWAITING_PAYMENT = 'awaiting_payment',
  CONFIRMING = 'confirming',
  CONFIRMED = 'confirmed',
  DISTRIBUTING = 'distributing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  EXPIRED = 'expired'
}

export interface PaymentRequest {
  id: string;
  userId: string;
  gameId?: string;
  walletAddress: string;
  amount: number;
  tokenMint: string;
  status: PaymentStatus;
  referenceKey: string;
  expiresAt: Date;
  qrCodeUrl?: string;
}

export interface PaymentOptions {
  gameId?: string;
  expirationMinutes?: number;
  metadata?: any;
}

export class PaymentService {
  private readonly PAYMENT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  private readonly TREASURY_FEE_PERCENT = 0.10; // 10%
  private readonly CONFIRMATION_BLOCKS = 32;
  private readonly CACHE_PREFIX = 'payment:';
  private activeMonitors = new Map<string, () => void>();

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly solanaService: SolanaService,
    private readonly walletService: WalletVerificationService,
    private readonly logger: StructuredLogger
  ) {}

  /**
   * Create a payment request
   */
  async createPaymentRequest(
    userId: string,
    amount: number,
    options: PaymentOptions = {}
  ): Promise<PaymentRequest> {
    const logContext = this.logger.createContext();

    try {
      // Get user's primary wallet
      const userWallet = await this.walletService.getPrimaryWallet(userId);
      if (!userWallet) {
        throw new Error('No verified wallet found. Please verify a wallet first.');
      }

      // Generate unique reference
      const referenceKey = `PAY-${generateRandomString(8)}-${Date.now().toString(36).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + (options.expirationMinutes || 10) * 60 * 1000);

      // Create payment request in database
      const insertQuery = `
        INSERT INTO payment_requests 
        (user_id, game_id, wallet_address, amount, token_mint, status, reference_key, expires_at, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      const result = await this.db.query(insertQuery, [
        userId,
        options.gameId || null,
        userWallet.walletAddress,
        amount,
        process.env.MWOR_TOKEN_MINT!,
        PaymentStatus.INITIATED,
        referenceKey,
        expiresAt,
        JSON.stringify(options.metadata || {})
      ]);

      const payment = result.rows[0];

      // Generate QR code for Solana Pay
      const qrCodeUrl = await this.generatePaymentQR(
        amount,
        referenceKey
      );

      // Update with QR code
      if (qrCodeUrl) {
        await this.db.query(
          'UPDATE payment_requests SET metadata = metadata || $1 WHERE id = $2',
          [JSON.stringify({ qrCodeUrl }), payment.id]
        );
      }

      // Cache payment details
      await this.cachePayment(payment);

      // Start monitoring for payment
      await this.startPaymentMonitoring(payment.id);

      // Update status to awaiting payment
      await this.updatePaymentStatus(
        payment.id,
        PaymentStatus.AWAITING_PAYMENT,
        'Payment request created'
      );

      this.logger.logPaymentEvent(logContext, {
        event: 'payment_created',
        paymentId: payment.id,
        userId,
        amount,
        metadata: options
      });

      return {
        id: payment.id,
        userId: payment.user_id,
        gameId: payment.game_id,
        walletAddress: payment.wallet_address,
        amount: parseFloat(payment.amount),
        tokenMint: payment.token_mint,
        status: PaymentStatus.AWAITING_PAYMENT,
        referenceKey: payment.reference_key,
        expiresAt: payment.expires_at,
        qrCodeUrl
      };
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'createPaymentRequest',
        userId,
        amount
      });
      throw error;
    }
  }

  /**
   * Generate Solana Pay QR code
   */
  private async generatePaymentQR(
    amount: number,
    reference: string
  ): Promise<string | null> {
    try {
      const botAddress = this.solanaService.getBotWalletAddress();
      
      // Solana Pay URL format
      const solanaPayUrl = `solana:${botAddress}?amount=${amount}&spl-token=${process.env.MWOR_TOKEN_MINT}&reference=${reference}&label=Lottery%20Bot&message=Entry%20Fee`;

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(solanaPayUrl, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 256,
        margin: 1
      });

      return qrCodeDataUrl;
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'generatePaymentQR'
      });
      return null;
    }
  }

  /**
   * Start monitoring for payment
   */
  private async startPaymentMonitoring(paymentId: string): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      // Get payment details
      const payment = await this.getPayment(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      const botAddress = this.solanaService.getBotWalletAddress();

      // Set up transaction monitoring
      const cleanup = await this.solanaService.monitorAddress(
        botAddress,
        async (transaction) => {
          // Check if this transaction is for our payment
          if (
            transaction.from === payment.walletAddress &&
            Math.abs(transaction.amount - payment.amount) < 0.000001
          ) {
            await this.handlePaymentReceived(paymentId, transaction);
          }
        }
      );

      // Store cleanup function
      this.activeMonitors.set(paymentId, cleanup);

      // Set timeout to expire payment
      setTimeout(async () => {
        const currentPayment = await this.getPayment(paymentId);
        if (currentPayment && currentPayment.status === PaymentStatus.AWAITING_PAYMENT) {
          await this.expirePayment(paymentId);
        }
      }, this.PAYMENT_TIMEOUT);

      this.logger.logInfo(logContext, 'Payment monitoring started', {
        paymentId,
        walletAddress: payment.walletAddress
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'startPaymentMonitoring',
        paymentId
      });
      throw error;
    }
  }

  /**
   * Handle received payment
   */
  private async handlePaymentReceived(
    paymentId: string,
    transaction: any
  ): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      // Update status to confirming
      await this.updatePaymentStatus(
        paymentId,
        PaymentStatus.CONFIRMING,
        'Payment detected, awaiting confirmations',
        { transactionSignature: transaction.signature }
      );

      // Record payment confirmation
      await this.db.query(`
        INSERT INTO payment_confirmations 
        (payment_id, transaction_signature, amount, from_address, to_address, raw_transaction)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        paymentId,
        transaction.signature,
        transaction.amount,
        transaction.from,
        transaction.to,
        JSON.stringify(transaction)
      ]);

      // Wait for confirmations
      const confirmed = await this.solanaService.waitForConfirmation(
        transaction.signature,
        this.CONFIRMATION_BLOCKS
      );

      if (confirmed) {
        await this.processConfirmedPayment(paymentId, transaction.signature);
      } else {
        await this.updatePaymentStatus(
          paymentId,
          PaymentStatus.FAILED,
          'Payment confirmation failed'
        );
      }
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'handlePaymentReceived',
        paymentId
      });
      
      await this.updatePaymentStatus(
        paymentId,
        PaymentStatus.FAILED,
        error.message
      );
    }
  }

  /**
   * Process confirmed payment
   */
  private async processConfirmedPayment(
    paymentId: string,
    transactionSignature: string
  ): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      // Update payment status
      await this.updatePaymentStatus(
        paymentId,
        PaymentStatus.CONFIRMED,
        'Payment confirmed on blockchain'
      );

      // Update payment record
      await this.db.query(
        'UPDATE payment_requests SET payment_signature = $1 WHERE id = $2',
        [transactionSignature, paymentId]
      );

      // Get payment details
      const payment = await this.getPayment(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      // Process treasury distribution
      await this.processTreasuryDistribution(payment);

      // Clean up monitoring
      this.stopPaymentMonitoring(paymentId);

      this.logger.logPaymentEvent(logContext, {
        event: 'payment_confirmed',
        paymentId,
        transactionSignature,
        amount: payment.amount
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'processConfirmedPayment',
        paymentId
      });
      throw error;
    }
  }

  /**
   * Process treasury fee distribution
   */
  private async processTreasuryDistribution(payment: PaymentRequest): Promise<void> {
    const logContext = this.logger.createContext();

    try {
      await this.updatePaymentStatus(
        payment.id,
        PaymentStatus.DISTRIBUTING,
        'Processing treasury distribution'
      );

      const treasuryAmount = payment.amount * this.TREASURY_FEE_PERCENT;

      // Record treasury distribution
      const distributionResult = await this.db.query(`
        INSERT INTO treasury_distributions 
        (payment_id, game_id, amount, token_mint, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        payment.id,
        payment.gameId,
        treasuryAmount,
        payment.tokenMint,
        'pending'
      ]);

      const distributionId = distributionResult.rows[0].id;

      // Send to treasury
      const treasurySignature = await this.solanaService.sendToTreasury(
        treasuryAmount,
        payment.tokenMint,
        payment.gameId
      );

      // Update distribution record
      await this.db.query(`
        UPDATE treasury_distributions 
        SET transaction_signature = $1, status = $2, completed_at = NOW()
        WHERE id = $3
      `, [treasurySignature, 'completed', distributionId]);

      // Update payment with treasury signature
      await this.db.query(
        'UPDATE payment_requests SET treasury_signature = $1 WHERE id = $2',
        [treasurySignature, payment.id]
      );

      // Mark payment as completed
      await this.updatePaymentStatus(
        payment.id,
        PaymentStatus.COMPLETED,
        'Payment and treasury distribution completed'
      );

      this.logger.logPaymentEvent(logContext, {
        event: 'treasury_distributed',
        paymentId: payment.id,
        treasuryAmount,
        treasurySignature
      });
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'processTreasuryDistribution',
        paymentId: payment.id
      });
      
      await this.updatePaymentStatus(
        payment.id,
        PaymentStatus.FAILED,
        `Treasury distribution failed: ${error.message}`
      );
      
      throw error;
    }
  }

  /**
   * Check payment status
   */
  async checkPaymentStatus(
    userId: string,
    referenceKey: string
  ): Promise<PaymentRequest | null> {
    const query = `
      SELECT * FROM payment_requests
      WHERE user_id = $1 AND reference_key = $2
    `;
    const result = await this.db.query(query, [userId, referenceKey]);

    if (result.rows.length === 0) {
      return null;
    }

    const payment = result.rows[0];
    return {
      id: payment.id,
      userId: payment.user_id,
      gameId: payment.game_id,
      walletAddress: payment.wallet_address,
      amount: parseFloat(payment.amount),
      tokenMint: payment.token_mint,
      status: payment.status,
      referenceKey: payment.reference_key,
      expiresAt: payment.expires_at
    };
  }

  /**
   * Get payment by ID
   */
  private async getPayment(paymentId: string): Promise<PaymentRequest | null> {
    const result = await this.db.query(
      'SELECT * FROM payment_requests WHERE id = $1',
      [paymentId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const payment = result.rows[0];
    return {
      id: payment.id,
      userId: payment.user_id,
      gameId: payment.game_id,
      walletAddress: payment.wallet_address,
      amount: parseFloat(payment.amount),
      tokenMint: payment.token_mint,
      status: payment.status,
      referenceKey: payment.reference_key,
      expiresAt: payment.expires_at
    };
  }

  /**
   * Update payment status with logging
   */
  private async updatePaymentStatus(
    paymentId: string,
    status: PaymentStatus,
    reason?: string,
    metadata?: any
  ): Promise<void> {
    await this.db.query(
      'SELECT update_payment_status($1, $2, $3, $4)',
      [paymentId, status, reason || null, JSON.stringify(metadata || {})]
    );

    // Update cache
    const cacheKey = `${this.CACHE_PREFIX}${paymentId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const payment = JSON.parse(cached);
      payment.status = status;
      await this.redis.setex(cacheKey, 300, JSON.stringify(payment));
    }
  }

  /**
   * Cache payment details
   */
  private async cachePayment(payment: any): Promise<void> {
    const cacheKey = `${this.CACHE_PREFIX}${payment.id}`;
    const referenceKey = `${this.CACHE_PREFIX}ref:${payment.reference_key}`;
    
    const ttl = Math.floor((payment.expires_at - Date.now()) / 1000);
    
    await this.redis.setex(cacheKey, ttl, JSON.stringify(payment));
    await this.redis.setex(referenceKey, ttl, payment.id);
  }

  /**
   * Expire payment
   */
  private async expirePayment(paymentId: string): Promise<void> {
    await this.updatePaymentStatus(
      paymentId,
      PaymentStatus.EXPIRED,
      'Payment request expired'
    );

    this.stopPaymentMonitoring(paymentId);
  }

  /**
   * Stop payment monitoring
   */
  private stopPaymentMonitoring(paymentId: string): void {
    const cleanup = this.activeMonitors.get(paymentId);
    if (cleanup) {
      cleanup();
      this.activeMonitors.delete(paymentId);
    }
  }

  /**
   * Process refund
   */
  async processRefund(
    paymentId: string,
    reason: string,
    approvedBy?: string
  ): Promise<string> {
    const logContext = this.logger.createContext();

    try {
      const payment = await this.getPayment(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new Error('Can only refund completed payments');
      }

      // Create refund record
      const refundResult = await this.db.query(`
        INSERT INTO refunds 
        (payment_id, user_id, amount, token_mint, reason, status, approved_by, approved_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        paymentId,
        payment.userId,
        payment.amount,
        payment.tokenMint,
        reason,
        approvedBy ? 'approved' : 'pending',
        approvedBy,
        approvedBy ? new Date() : null
      ]);

      const refundId = refundResult.rows[0].id;

      if (approvedBy) {
        // Process refund immediately
        const refundSignature = await this.solanaService.sendTokens(
          payment.walletAddress,
          payment.amount,
          payment.tokenMint
        );

        await this.db.query(`
          UPDATE refunds 
          SET transaction_signature = $1, status = $2, completed_at = NOW()
          WHERE id = $3
        `, [refundSignature, 'completed', refundId]);

        await this.updatePaymentStatus(
          paymentId,
          PaymentStatus.REFUNDED,
          `Refunded: ${reason}`
        );

        this.logger.logPaymentEvent(logContext, {
          event: 'payment_refunded',
          paymentId,
          refundId,
          amount: payment.amount,
          reason
        });

        return refundSignature;
      }

      return refundId;
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'processRefund',
        paymentId,
        reason
      });
      throw error;
    }
  }

  /**
   * Clean up expired payments
   */
  async cleanupExpiredPayments(): Promise<void> {
    const result = await this.db.query(`
      UPDATE payment_requests 
      SET status = $1
      WHERE status = $2 
        AND expires_at < NOW()
      RETURNING id
    `, [PaymentStatus.EXPIRED, PaymentStatus.AWAITING_PAYMENT]);

    // Stop monitoring for expired payments
    for (const row of result.rows) {
      this.stopPaymentMonitoring(row.id);
    }
  }
}