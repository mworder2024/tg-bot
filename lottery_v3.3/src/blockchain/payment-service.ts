import {
  PaymentRecord,
  PaymentRequest,
  PaymentStatus,
  BlockchainConfig,
  PaymentError
} from '../types/blockchain.js';
import { WalletManager } from './wallet-manager.js';
import winston from 'winston';
import * as crypto from 'crypto';

export class PaymentService {
  private walletManager: WalletManager;
  private config: BlockchainConfig;
  private logger: winston.Logger;
  private paymentMonitorInterval: NodeJS.Timeout | null = null;
  private activePayments: Map<string, PaymentRecord> = new Map();

  constructor(
    walletManager: WalletManager,
    config: BlockchainConfig,
    logger: winston.Logger
  ) {
    this.walletManager = walletManager;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Initialize payment service and start monitoring
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing payment service...');
    this.startPaymentMonitoring();
    this.logger.info('Payment service initialized');
  }

  /**
   * Shutdown payment service
   */
  shutdown(): void {
    if (this.paymentMonitorInterval) {
      clearInterval(this.paymentMonitorInterval);
      this.paymentMonitorInterval = null;
    }
    this.logger.info('Payment service shutdown');
  }

  /**
   * Create a new payment request
   */
  async createPaymentRequest(
    userId: string,
    gameId: string,
    amount: number
  ): Promise<PaymentRequest> {
    try {
      // Generate unique payment ID
      const paymentId = this.generatePaymentId(userId);
      
      // Create payment request through wallet manager
      const paymentRequest = await this.walletManager.createPaymentRequest(
        userId,
        gameId,
        amount
      );

      // Create payment record
      const paymentRecord: PaymentRecord = {
        paymentId,
        userId,
        gameId,
        amount,
        status: 'pending',
        timestamp: new Date(),
        expiresAt: paymentRequest.expiresAt,
        retryCount: 0
      };

      // Store in active payments for monitoring
      this.activePayments.set(paymentId, paymentRecord);

      this.logger.info(`Payment request created: ${paymentId} for user ${userId}, amount: ${amount} MWOR`);

      return {
        ...paymentRequest,
        paymentId
      };
    } catch (error) {
      this.logger.error(`Failed to create payment request for user ${userId}:`, error);
      throw new PaymentError(
        `Failed to create payment request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'unknown',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Generate unique payment ID
   */
  private generatePaymentId(userId: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `pay_${timestamp}_${userId}_${random}`;
  }

  /**
   * Check payment status
   */
  async checkPaymentStatus(paymentId: string): Promise<PaymentRecord | null> {
    const payment = this.activePayments.get(paymentId);
    
    if (!payment) {
      // Try to load from database if implemented
      return null;
    }

    // Check if payment has expired
    if (payment.status === 'pending' && new Date() > payment.expiresAt) {
      payment.status = 'expired';
      this.activePayments.set(paymentId, payment);
      this.logger.info(`Payment expired: ${paymentId}`);
    }

    return payment;
  }

  /**
   * Manually verify a payment (for troubleshooting)
   */
  async verifyPayment(paymentId: string): Promise<PaymentRecord | null> {
    const payment = this.activePayments.get(paymentId);
    
    if (!payment || payment.status !== 'pending') {
      return payment || null;
    }

    try {
      const result = await this.walletManager.verifyPayment(
        paymentId,
        payment.amount
      );

      if (result.received && result.transactionHash) {
        payment.status = 'confirmed';
        payment.transactionHash = result.transactionHash;
        payment.confirmationTime = new Date();
        this.activePayments.set(paymentId, payment);
        
        this.logger.info(`Payment confirmed: ${paymentId}, transaction: ${result.transactionHash}`);
      } else {
        payment.retryCount++;
        this.activePayments.set(paymentId, payment);
      }

      return payment;
    } catch (error) {
      this.logger.error(`Failed to verify payment ${paymentId}:`, error);
      payment.status = 'failed';
      this.activePayments.set(paymentId, payment);
      return payment;
    }
  }

  /**
   * Start background payment monitoring
   */
  private startPaymentMonitoring(): void {
    if (this.paymentMonitorInterval) {
      clearInterval(this.paymentMonitorInterval);
    }

    this.paymentMonitorInterval = setInterval(async () => {
      try {
        await this.monitorActivePayments();
      } catch (error) {
        this.logger.error('Error in payment monitoring:', error);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Monitor all active payments for confirmations
   */
  private async monitorActivePayments(): Promise<void> {
    const now = new Date();
    const pendingPayments = Array.from(this.activePayments.values())
      .filter(payment => payment.status === 'pending');

    for (const payment of pendingPayments) {
      try {
        // Check if payment has expired
        if (now > payment.expiresAt) {
          payment.status = 'expired';
          this.activePayments.set(payment.paymentId, payment);
          this.logger.info(`Payment expired: ${payment.paymentId}`);
          continue;
        }

        // Skip if we've retried too many times recently
        if (payment.retryCount > 10 && 
            (now.getTime() - payment.timestamp.getTime()) < 60000) {
          continue;
        }

        // Check for payment
        const result = await this.walletManager.verifyPayment(
          payment.paymentId,
          payment.amount
        );

        if (result.received && result.transactionHash) {
          payment.status = 'confirmed';
          payment.transactionHash = result.transactionHash;
          payment.confirmationTime = new Date();
          this.activePayments.set(payment.paymentId, payment);
          
          this.logger.info(`Payment auto-confirmed: ${payment.paymentId}, transaction: ${result.transactionHash}`);
          
          // Notify about payment confirmation (could emit event here)
          this.onPaymentConfirmed(payment);
        } else {
          payment.retryCount++;
          this.activePayments.set(payment.paymentId, payment);
        }
      } catch (error) {
        this.logger.warn(`Error checking payment ${payment.paymentId}:`, error);
        payment.retryCount++;
        this.activePayments.set(payment.paymentId, payment);
      }

      // Small delay between checks to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Clean up old payments (keep for 24 hours)
    const cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    for (const [paymentId, payment] of this.activePayments.entries()) {
      if (payment.timestamp < cutoffTime && 
          ['confirmed', 'failed', 'expired', 'refunded'].includes(payment.status)) {
        this.activePayments.delete(paymentId);
      }
    }
  }

  /**
   * Handle payment confirmation event
   */
  private onPaymentConfirmed(payment: PaymentRecord): void {
    // This could emit an event or call a callback
    // For now, just log the confirmation
    this.logger.info(`Payment confirmed for user ${payment.userId}, game ${payment.gameId}`);
    
    // In a real implementation, this would trigger game entry confirmation
    // or call a callback function provided during initialization
  }

  /**
   * Get all payments for a user
   */
  getUserPayments(userId: string): PaymentRecord[] {
    return Array.from(this.activePayments.values())
      .filter(payment => payment.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get all payments for a game
   */
  getGamePayments(gameId: string): PaymentRecord[] {
    return Array.from(this.activePayments.values())
      .filter(payment => payment.gameId === gameId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get payment statistics
   */
  getPaymentStats(): {
    total: number;
    pending: number;
    confirmed: number;
    failed: number;
    expired: number;
    totalVolume: number;
  } {
    const payments = Array.from(this.activePayments.values());
    
    return {
      total: payments.length,
      pending: payments.filter(p => p.status === 'pending').length,
      confirmed: payments.filter(p => p.status === 'confirmed').length,
      failed: payments.filter(p => p.status === 'failed').length,
      expired: payments.filter(p => p.status === 'expired').length,
      totalVolume: payments
        .filter(p => p.status === 'confirmed')
        .reduce((sum, p) => sum + p.amount, 0)
    };
  }

  /**
   * Cancel a payment (mark as failed and optionally refund)
   */
  async cancelPayment(paymentId: string, reason: string): Promise<boolean> {
    const payment = this.activePayments.get(paymentId);
    
    if (!payment) {
      return false;
    }

    if (payment.status === 'confirmed') {
      this.logger.warn(`Cannot cancel confirmed payment: ${paymentId}`);
      return false;
    }

    payment.status = 'failed';
    this.activePayments.set(paymentId, payment);
    
    this.logger.info(`Payment cancelled: ${paymentId}, reason: ${reason}`);
    return true;
  }

  /**
   * Process refund for a payment
   */
  async refundPayment(
    paymentId: string,
    userWalletAddress: string,
    reason: string
  ): Promise<boolean> {
    const payment = this.activePayments.get(paymentId);
    
    if (!payment || payment.status !== 'confirmed') {
      this.logger.warn(`Cannot refund payment ${paymentId}: not found or not confirmed`);
      return false;
    }

    try {
      const refundRequests = [{
        userId: payment.userId,
        amount: payment.amount,
        walletAddress: userWalletAddress
      }];

      const results = await this.walletManager.processRefunds(payment.gameId, refundRequests);
      const refundResult = results[0];

      if (refundResult.success && refundResult.transactionHash) {
        payment.status = 'refunded';
        payment.refundHash = refundResult.transactionHash;
        this.activePayments.set(paymentId, payment);
        
        this.logger.info(`Payment refunded: ${paymentId}, transaction: ${refundResult.transactionHash}`);
        return true;
      } else {
        this.logger.error(`Refund failed for payment ${paymentId}: ${refundResult.error}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error processing refund for payment ${paymentId}:`, error);
      return false;
    }
  }

  /**
   * Get active payment count
   */
  getActivePaymentCount(): number {
    return Array.from(this.activePayments.values())
      .filter(payment => payment.status === 'pending').length;
  }

  /**
   * Force update payment status (for emergency situations)
   */
  forceUpdatePaymentStatus(paymentId: string, status: PaymentStatus): boolean {
    const payment = this.activePayments.get(paymentId);
    
    if (!payment) {
      return false;
    }

    payment.status = status;
    this.activePayments.set(paymentId, payment);
    
    this.logger.warn(`Payment status force updated: ${paymentId} -> ${status}`);
    return true;
  }
}