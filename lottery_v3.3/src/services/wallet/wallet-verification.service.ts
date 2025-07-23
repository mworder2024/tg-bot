import { Connection, PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { randomBytes } from 'crypto';
import { StructuredLogger } from '../../utils/structured-logger';
import { SolanaService } from '../blockchain/solana.service';

export interface VerificationRequest {
  userId: string;
  walletAddress: string;
  amount: number;
  token: string;
  expiresAt: Date;
}

export interface VerifiedWallet {
  id: string;
  userId: string;
  walletAddress: string;
  isPrimary: boolean;
  verificationTx: string;
}

export class WalletVerificationService {
  private readonly MIN_AMOUNT = 0.001;
  private readonly MAX_AMOUNT = 0.009;
  private readonly VERIFICATION_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  private readonly CACHE_PREFIX = 'wallet:verification:';

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly solanaService: SolanaService,
    private readonly logger: StructuredLogger
  ) {}

  /**
   * Generate a unique verification token
   */
  private generateToken(): string {
    const random = randomBytes(4).toString('hex').toUpperCase();
    return `VERIFY-${random}`;
  }

  /**
   * Generate a random verification amount
   */
  private generateAmount(): number {
    return (Math.floor(Math.random() * 9) + 1) / 1000;
  }

  /**
   * Validate Solana wallet address format
   */
  isValidAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initiate wallet verification process
   */
  async initiateVerification(
    userId: string,
    walletAddress: string
  ): Promise<VerificationRequest> {
    const logContext = this.logger.createContext();

    try {
      // Validate address format
      if (!this.isValidAddress(walletAddress)) {
        throw new Error('Invalid Solana wallet address');
      }

      // Check if wallet is already verified
      const existingWallet = await this.getVerifiedWallet(userId, walletAddress);
      if (existingWallet) {
        throw new Error('Wallet is already verified');
      }

      // Check for pending verification
      const pendingQuery = `
        SELECT * FROM wallet_verifications
        WHERE user_id = $1 
          AND wallet_address = $2 
          AND status = 'pending'
          AND expires_at > NOW()
      `;
      const pendingResult = await this.db.query(pendingQuery, [userId, walletAddress]);
      
      if (pendingResult.rows.length > 0) {
        const pending = pendingResult.rows[0];
        return {
          userId,
          walletAddress,
          amount: parseFloat(pending.verification_amount),
          token: pending.verification_token,
          expiresAt: pending.expires_at
        };
      }

      // Generate new verification
      const amount = this.generateAmount();
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + this.VERIFICATION_TIMEOUT);

      // Store in database
      const insertQuery = `
        INSERT INTO wallet_verifications 
        (user_id, wallet_address, verification_amount, verification_token, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      await this.db.query(insertQuery, [
        userId,
        walletAddress,
        amount,
        token,
        expiresAt
      ]);

      // Cache verification details
      const cacheKey = `${this.CACHE_PREFIX}${token}`;
      await this.redis.setex(
        cacheKey,
        600, // 10 minutes
        JSON.stringify({ userId, walletAddress, amount })
      );

      this.logger.logUserAction(logContext, {
        action: 'wallet_verification_initiated',
        userId,
        metadata: { walletAddress, token, amount }
      });

      return { userId, walletAddress, amount, token, expiresAt };
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'initiateVerification',
        userId,
        walletAddress
      });
      throw error;
    }
  }

  /**
   * Check if verification payment has been received
   */
  async checkVerification(
    userId: string,
    token: string
  ): Promise<boolean> {
    const logContext = this.logger.createContext();

    try {
      // Get verification details
      const query = `
        SELECT * FROM wallet_verifications
        WHERE user_id = $1 
          AND verification_token = $2
          AND status = 'pending'
          AND expires_at > NOW()
      `;
      const result = await this.db.query(query, [userId, token]);

      if (result.rows.length === 0) {
        throw new Error('Verification not found or expired');
      }

      const verification = result.rows[0];
      const { wallet_address, verification_amount, created_at } = verification;

      // Check for transaction from this wallet
      const transaction = await this.solanaService.findTransaction({
        from: wallet_address,
        to: process.env.BOT_WALLET_ADDRESS!,
        amount: parseFloat(verification_amount),
        after: created_at,
        token: process.env.MWOR_TOKEN_MINT!
      });

      if (!transaction) {
        return false;
      }

      // Mark as verified
      await this.db.query('BEGIN');
      
      try {
        // Update verification status
        await this.db.query(
          `UPDATE wallet_verifications 
           SET status = 'verified', 
               transaction_signature = $1,
               verified_at = NOW()
           WHERE id = $2`,
          [transaction.signature, verification.id]
        );

        // Create verified wallet record
        const walletQuery = `
          INSERT INTO verified_wallets 
          (user_id, wallet_address, verification_tx, is_primary)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (wallet_address) DO NOTHING
          RETURNING *
        `;
        
        // First wallet is primary by default
        const isPrimary = await this.isFirstWallet(userId);
        
        await this.db.query(walletQuery, [
          userId,
          wallet_address,
          transaction.signature,
          isPrimary
        ]);

        await this.db.query('COMMIT');

        // Clear cache
        await this.redis.del(`${this.CACHE_PREFIX}${token}`);

        // Return verification amount (minus network fee)
        await this.returnVerificationAmount(
          wallet_address,
          parseFloat(verification_amount)
        );

        this.logger.logUserAction(logContext, {
          action: 'wallet_verified',
          userId,
          metadata: { walletAddress: wallet_address, transactionSignature: transaction.signature }
        });

        return true;
      } catch (error) {
        await this.db.query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'checkVerification',
        userId,
        token
      });
      throw error;
    }
  }

  /**
   * Return verification amount to user
   */
  private async returnVerificationAmount(
    walletAddress: string,
    amount: number
  ): Promise<void> {
    try {
      // Deduct small network fee (0.000005 SOL)
      const returnAmount = amount - 0.000005;
      
      if (returnAmount > 0) {
        await this.solanaService.sendTokens(
          walletAddress,
          returnAmount,
          process.env.MWOR_TOKEN_MINT!
        );
      }
    } catch (error) {
      // Log but don't throw - verification is still valid
      this.logger.logError(
        this.logger.createContext(),
        error as Error,
        { operation: 'returnVerificationAmount', walletAddress, amount }
      );
    }
  }

  /**
   * Check if this is user's first wallet
   */
  private async isFirstWallet(userId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT COUNT(*) as count FROM verified_wallets WHERE user_id = $1',
      [userId]
    );
    return parseInt(result.rows[0].count) === 0;
  }

  /**
   * Get user's verified wallets
   */
  async getUserWallets(userId: string): Promise<VerifiedWallet[]> {
    const query = `
      SELECT * FROM verified_wallets 
      WHERE user_id = $1 
      ORDER BY is_primary DESC, created_at ASC
    `;
    const result = await this.db.query(query, [userId]);
    
    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      walletAddress: row.wallet_address,
      isPrimary: row.is_primary,
      verificationTx: row.verification_tx
    }));
  }

  /**
   * Get specific verified wallet
   */
  async getVerifiedWallet(
    userId: string,
    walletAddress: string
  ): Promise<VerifiedWallet | null> {
    const query = `
      SELECT * FROM verified_wallets 
      WHERE user_id = $1 AND wallet_address = $2
    `;
    const result = await this.db.query(query, [userId, walletAddress]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      walletAddress: row.wallet_address,
      isPrimary: row.is_primary,
      verificationTx: row.verification_tx
    };
  }

  /**
   * Get user's primary wallet
   */
  async getPrimaryWallet(userId: string): Promise<VerifiedWallet | null> {
    const query = `
      SELECT * FROM verified_wallets 
      WHERE user_id = $1 AND is_primary = true
    `;
    const result = await this.db.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      walletAddress: row.wallet_address,
      isPrimary: true,
      verificationTx: row.verification_tx
    };
  }

  /**
   * Set primary wallet
   */
  async setPrimaryWallet(
    userId: string,
    walletAddress: string
  ): Promise<void> {
    await this.db.query('BEGIN');
    
    try {
      // Remove primary flag from all user's wallets
      await this.db.query(
        'UPDATE verified_wallets SET is_primary = false WHERE user_id = $1',
        [userId]
      );

      // Set new primary
      await this.db.query(
        'UPDATE verified_wallets SET is_primary = true WHERE user_id = $1 AND wallet_address = $2',
        [userId, walletAddress]
      );

      await this.db.query('COMMIT');
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Remove wallet verification
   */
  async removeWallet(
    userId: string,
    walletAddress: string
  ): Promise<void> {
    const result = await this.db.query(
      'DELETE FROM verified_wallets WHERE user_id = $1 AND wallet_address = $2 RETURNING is_primary',
      [userId, walletAddress]
    );

    // If removed wallet was primary, set another as primary
    if (result.rows.length > 0 && result.rows[0].is_primary) {
      const nextWallet = await this.db.query(
        'SELECT wallet_address FROM verified_wallets WHERE user_id = $1 LIMIT 1',
        [userId]
      );

      if (nextWallet.rows.length > 0) {
        await this.setPrimaryWallet(userId, nextWallet.rows[0].wallet_address);
      }
    }
  }

  /**
   * Clean up expired verifications
   */
  async cleanupExpiredVerifications(): Promise<void> {
    await this.db.query(
      `UPDATE wallet_verifications 
       SET status = 'expired' 
       WHERE status = 'pending' AND expires_at < NOW()`
    );
  }
}