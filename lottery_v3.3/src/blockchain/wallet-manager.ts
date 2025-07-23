import { Keypair } from '@solana/web3.js';
import * as crypto from 'crypto';
import * as bs58 from 'bs58';
import { 
  BlockchainConfig, 
  WalletBalance, 
  PaymentRequest, 
  TransactionResult,
  DistributionResult,
  WinnerInfo,
  WalletError
} from '../types/blockchain.js';
import { SolanaService } from './solana-service.js';
import winston from 'winston';

export class WalletManager {
  private botWallet: Keypair | null = null;
  private treasuryWallet: Keypair | null = null;
  private solanaService: SolanaService;
  private config: BlockchainConfig;
  private logger: winston.Logger;

  constructor(config: BlockchainConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
    this.solanaService = new SolanaService(config, logger);
  }

  /**
   * Initialize wallet manager by loading or generating wallets
   */
  async initialize(): Promise<void> {
    try {
      // Load bot wallet from encrypted private key
      if (this.config.botWalletPrivateKey) {
        this.botWallet = this.loadWalletFromEncryptedKey(this.config.botWalletPrivateKey);
        this.logger.info(`Bot wallet loaded: ${this.botWallet.publicKey.toString()}`);
      }

      // Load treasury wallet from encrypted private key
      if (this.config.treasuryWalletPrivateKey) {
        this.treasuryWallet = this.loadWalletFromEncryptedKey(this.config.treasuryWalletPrivateKey);
        this.logger.info(`Treasury wallet loaded: ${this.treasuryWallet.publicKey.toString()}`);
      }

      if (!this.botWallet || !this.treasuryWallet) {
        throw new WalletError(
          'Bot wallet and treasury wallet must be configured before initialization'
        );
      }

      // Verify connectivity
      const isConnected = await this.solanaService.isConnected();
      if (!isConnected) {
        throw new WalletError('Failed to connect to Solana network');
      }

      this.logger.info('Wallet manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize wallet manager:', error);
      throw error;
    }
  }

  /**
   * Generate new bot and treasury wallets (for initial setup)
   */
  generateBotWallets(): { botWallet: string; treasuryWallet: string; publicKeys: { bot: string; treasury: string } } {
    const botKeypair = Keypair.generate();
    const treasuryKeypair = Keypair.generate();

    const encryptedBotKey = this.encryptPrivateKey(botKeypair.secretKey);
    const encryptedTreasuryKey = this.encryptPrivateKey(treasuryKeypair.secretKey);

    return {
      botWallet: encryptedBotKey,
      treasuryWallet: encryptedTreasuryKey,
      publicKeys: {
        bot: botKeypair.publicKey.toString(),
        treasury: treasuryKeypair.publicKey.toString()
      }
    };
  }

  /**
   * Encrypt private key using configured encryption key
   */
  private encryptPrivateKey(privateKey: Uint8Array): string {
    const cipher = crypto.createCipher('aes256', this.config.encryptionKey);
    const base58Key = bs58.encode(privateKey);
    let encrypted = cipher.update(base58Key, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  /**
   * Decrypt private key using configured encryption key
   */
  private decryptPrivateKey(encryptedKey: string): Uint8Array {
    const decipher = crypto.createDecipher('aes256', this.config.encryptionKey);
    let decrypted = decipher.update(encryptedKey, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return bs58.decode(decrypted);
  }

  /**
   * Load wallet from encrypted private key
   */
  private loadWalletFromEncryptedKey(encryptedKey: string): Keypair {
    try {
      const privateKey = this.decryptPrivateKey(encryptedKey);
      return Keypair.fromSecretKey(privateKey);
    } catch (error) {
      throw new WalletError(
        'Failed to load wallet from encrypted key',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get bot wallet public address
   */
  getBotWalletAddress(): string {
    if (!this.botWallet) {
      throw new WalletError('Bot wallet not initialized');
    }
    return this.botWallet.publicKey.toString();
  }

  /**
   * Get treasury wallet public address
   */
  getTreasuryWalletAddress(): string {
    if (!this.treasuryWallet) {
      throw new WalletError('Treasury wallet not initialized');
    }
    return this.treasuryWallet.publicKey.toString();
  }

  /**
   * Get bot wallet balance
   */
  async getBotWalletBalance(): Promise<WalletBalance> {
    if (!this.botWallet) {
      throw new WalletError('Bot wallet not initialized');
    }
    return await this.solanaService.getWalletBalance(this.botWallet.publicKey.toString());
  }

  /**
   * Get treasury wallet balance
   */
  async getTreasuryWalletBalance(): Promise<WalletBalance> {
    if (!this.treasuryWallet) {
      throw new WalletError('Treasury wallet not initialized');
    }
    return await this.solanaService.getWalletBalance(this.treasuryWallet.publicKey.toString());
  }

  /**
   * Create a payment request for a user
   */
  async createPaymentRequest(
    userId: string,
    gameId: string,
    amount: number
  ): Promise<PaymentRequest> {
    if (!this.botWallet) {
      throw new WalletError('Bot wallet not initialized');
    }

    const paymentId = `pay_${Date.now()}_${userId}`;
    const expiresAt = new Date(Date.now() + (this.config.paymentTimeoutMinutes * 60 * 1000));

    const instructions = `
🔸 Payment Instructions 🔸

💰 Amount: ${amount} MWOR tokens
📍 Send to: ${this.getBotWalletAddress()}
🆔 Payment ID: ${paymentId}
⏰ Expires: ${expiresAt.toLocaleString()}

Steps:
1. Open your Solana wallet app
2. Send exactly ${amount} MWOR tokens to the address above
3. Wait for confirmation message
4. Your entry will be confirmed automatically

⚠️ Important:
- Send exact amount only
- Payment expires in ${this.config.paymentTimeoutMinutes} minutes
- Refunds available if game cancelled
`;

    return {
      paymentId,
      gameId,
      userId,
      amount,
      botWalletAddress: this.getBotWalletAddress(),
      instructions,
      expiresAt
    };
  }

  /**
   * Check if a payment has been received
   */
  async verifyPayment(
    paymentId: string,
    expectedAmount: number,
    afterSignature?: string
  ): Promise<{ received: boolean; transactionHash?: string; actualAmount?: number }> {
    if (!this.botWallet) {
      throw new WalletError('Bot wallet not initialized');
    }

    try {
      const result = await this.solanaService.checkForIncomingTransfer(
        this.getBotWalletAddress(),
        expectedAmount,
        afterSignature
      );

      if (result.found) {
        this.logger.info(`Payment verified for ${paymentId}: ${result.transactionHash}`);
      }

      return {
        received: result.found,
        transactionHash: result.transactionHash,
        actualAmount: result.actualAmount
      };
    } catch (error) {
      this.logger.error(`Failed to verify payment ${paymentId}:`, error);
      throw new WalletError(
        `Payment verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.getBotWalletAddress(),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Distribute prizes to winners
   */
  async distributePrizes(
    gameId: string,
    winners: WinnerInfo[],
    totalPrizePool: number
  ): Promise<DistributionResult> {
    if (!this.botWallet || !this.treasuryWallet) {
      throw new WalletError('Wallets not initialized');
    }

    const systemFee = Math.floor(totalPrizePool * (this.config.systemFeePercentage / 100));
    const prizeAmount = totalPrizePool - systemFee;
    const amountPerWinner = Math.floor(prizeAmount / winners.length);

    const transactionHashes: string[] = [];
    const failedTransfers: Array<{ userId: string; amount: number; error: string }> = [];

    try {
      // First, transfer system fee to treasury
      if (systemFee > 0) {
        this.logger.info(`Transferring system fee: ${systemFee} MWOR`);
        const treasuryResult = await this.solanaService.transferMworTokens(
          this.botWallet,
          this.getTreasuryWalletAddress(),
          systemFee
        );

        if (treasuryResult.success && treasuryResult.transactionHash) {
          transactionHashes.push(treasuryResult.transactionHash);
          this.logger.info(`System fee transferred: ${treasuryResult.transactionHash}`);
        } else {
          this.logger.error(`Failed to transfer system fee: ${treasuryResult.error}`);
        }
      }

      // Distribute prizes to winners
      for (const winner of winners) {
        try {
          this.logger.info(`Distributing ${amountPerWinner} MWOR to ${winner.username}`);
          
          const result = await this.solanaService.transferMworTokens(
            this.botWallet,
            winner.walletAddress,
            amountPerWinner
          );

          if (result.success && result.transactionHash) {
            transactionHashes.push(result.transactionHash);
            this.logger.info(`Prize distributed to ${winner.username}: ${result.transactionHash}`);
          } else {
            failedTransfers.push({
              userId: winner.userId,
              amount: amountPerWinner,
              error: result.error || 'Unknown error'
            });
            this.logger.error(`Failed to distribute prize to ${winner.username}: ${result.error}`);
          }
        } catch (error) {
          failedTransfers.push({
            userId: winner.userId,
            amount: amountPerWinner,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          this.logger.error(`Error distributing prize to ${winner.username}:`, error);
        }

        // Add delay between transactions to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const totalDistributed = amountPerWinner * (winners.length - failedTransfers.length);

      return {
        success: failedTransfers.length === 0,
        transactionHashes,
        totalDistributed,
        systemFeeCollected: systemFee,
        failedTransfers
      };
    } catch (error) {
      this.logger.error(`Failed to distribute prizes for game ${gameId}:`, error);
      throw new WalletError(
        `Prize distribution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Process refunds for a cancelled game
   */
  async processRefunds(
    gameId: string,
    refundRequests: Array<{ userId: string; amount: number; walletAddress: string }>
  ): Promise<TransactionResult[]> {
    if (!this.botWallet) {
      throw new WalletError('Bot wallet not initialized');
    }

    const results: TransactionResult[] = [];

    for (const refund of refundRequests) {
      try {
        this.logger.info(`Processing refund: ${refund.amount} MWOR to ${refund.userId}`);
        
        const result = await this.solanaService.transferMworTokens(
          this.botWallet,
          refund.walletAddress,
          refund.amount
        );

        results.push(result);

        if (result.success) {
          this.logger.info(`Refund successful for ${refund.userId}: ${result.transactionHash}`);
        } else {
          this.logger.error(`Refund failed for ${refund.userId}: ${result.error}`);
        }

        // Add delay between transactions
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        this.logger.error(`Error processing refund for ${refund.userId}:`, error);
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Check wallet balances and log warnings if low
   */
  async checkWalletHealth(): Promise<{
    botWallet: WalletBalance;
    treasuryWallet: WalletBalance;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    const botBalance = await this.getBotWalletBalance();
    const treasuryBalance = await this.getTreasuryWalletBalance();

    // Check SOL balance for transaction fees
    if (botBalance.solBalance < 0.01 * 1e9) { // Less than 0.01 SOL
      warnings.push('Bot wallet SOL balance low - may not be able to process transactions');
    }

    if (treasuryBalance.solBalance < 0.01 * 1e9) {
      warnings.push('Treasury wallet SOL balance low');
    }

    // Log warnings
    warnings.forEach(warning => this.logger.warn(warning));

    return {
      botWallet: botBalance,
      treasuryWallet: treasuryBalance,
      warnings
    };
  }
}