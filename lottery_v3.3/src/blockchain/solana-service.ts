import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionSignature,
  ParsedAccountData,
  TokenAccountBalancePair
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { BlockchainConfig, WalletBalance, TransactionResult, BlockchainError } from '../types/blockchain.js';
import winston from 'winston';

export class SolanaService {
  private connection: Connection;
  private config: BlockchainConfig;
  private logger: winston.Logger;

  constructor(config: BlockchainConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000
    });
  }

  /**
   * Get the current Solana network connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Generate a new Solana wallet keypair
   */
  generateWallet(): Keypair {
    return Keypair.generate();
  }

  /**
   * Get wallet balance for SOL and MWOR tokens
   */
  async getWalletBalance(walletAddress: string): Promise<WalletBalance> {
    try {
      const publicKey = new PublicKey(walletAddress);

      // Get SOL balance
      const solBalance = await this.connection.getBalance(publicKey);

      // Get MWOR token balance
      let mworBalance = 0;
      try {
        const mworTokenMint = new PublicKey(this.config.mworTokenMint);
        const associatedTokenAddress = await getAssociatedTokenAddress(
          mworTokenMint,
          publicKey
        );

        const tokenAccount = await getAccount(this.connection, associatedTokenAddress);
        mworBalance = Number(tokenAccount.amount);
      } catch (error) {
        // Token account might not exist, which is fine
        this.logger.debug(`No MWOR token account found for ${walletAddress}:`, error);
      }

      return {
        address: walletAddress,
        solBalance,
        mworBalance,
        lastUpdated: new Date()
      };
    } catch (error) {
      this.logger.error(`Failed to get wallet balance for ${walletAddress}:`, error);
      throw new BlockchainError(
        `Failed to get wallet balance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BALANCE_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if a wallet address is valid
   */
  isValidWalletAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get transaction details by signature
   */
  async getTransaction(signature: string): Promise<any> {
    try {
      const transaction = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      return transaction;
    } catch (error) {
      this.logger.error(`Failed to get transaction ${signature}:`, error);
      throw new BlockchainError(
        `Failed to get transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TRANSACTION_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(
    signature: TransactionSignature,
    timeoutMs: number = 60000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await this.connection.getSignatureStatus(signature);
        
        if (status.value?.confirmationStatus === 'confirmed' || 
            status.value?.confirmationStatus === 'finalized') {
          return true;
        }
        
        if (status.value?.err) {
          this.logger.error(`Transaction ${signature} failed:`, status.value.err);
          return false;
        }
        
        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        this.logger.warn(`Error checking transaction status for ${signature}:`, error);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return false;
  }

  /**
   * Create and send a MWOR token transfer transaction
   */
  async transferMworTokens(
    fromKeypair: Keypair,
    toAddress: string,
    amount: number
  ): Promise<TransactionResult> {
    try {
      const mworTokenMint = new PublicKey(this.config.mworTokenMint);
      const fromPublicKey = fromKeypair.publicKey;
      const toPublicKey = new PublicKey(toAddress);

      // Get associated token addresses
      const fromTokenAddress = await getAssociatedTokenAddress(
        mworTokenMint,
        fromPublicKey
      );

      const toTokenAddress = await getAssociatedTokenAddress(
        mworTokenMint,
        toPublicKey
      );

      const transaction = new Transaction();

      // Check if recipient's token account exists, create if not
      try {
        await getAccount(this.connection, toTokenAddress);
      } catch {
        // Account doesn't exist, add instruction to create it
        transaction.add(
          createAssociatedTokenAccountInstruction(
            fromPublicKey, // payer
            toTokenAddress, // associated token account
            toPublicKey, // owner
            mworTokenMint // mint
          )
        );
      }

      // Add transfer instruction
      transaction.add(
        createTransferInstruction(
          fromTokenAddress, // source
          toTokenAddress, // destination
          fromPublicKey, // owner
          amount // amount
        )
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromPublicKey;

      // Sign and send transaction
      transaction.sign(fromKeypair);
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: false }
      );

      this.logger.info(`MWOR transfer transaction sent: ${signature}`);

      // Wait for confirmation
      const confirmed = await this.waitForConfirmation(signature);

      if (confirmed) {
        this.logger.info(`MWOR transfer confirmed: ${signature}`);
        return {
          success: true,
          transactionHash: signature,
          confirmationTime: new Date()
        };
      } else {
        this.logger.error(`MWOR transfer failed to confirm: ${signature}`);
        return {
          success: false,
          error: 'Transaction failed to confirm within timeout'
        };
      }
    } catch (error) {
      this.logger.error(`Failed to transfer MWOR tokens:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check for incoming MWOR token transfers to a specific address
   */
  async checkForIncomingTransfer(
    walletAddress: string,
    expectedAmount: number,
    afterSignature?: string
  ): Promise<{ found: boolean; transactionHash?: string; actualAmount?: number }> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const mworTokenMint = new PublicKey(this.config.mworTokenMint);
      
      const associatedTokenAddress = await getAssociatedTokenAddress(
        mworTokenMint,
        publicKey
      );

      // Get transaction signatures for the token account
      const signatures = await this.connection.getSignaturesForAddress(
        associatedTokenAddress,
        {
          limit: 50,
          before: afterSignature
        }
      );

      for (const signatureInfo of signatures) {
        try {
          const transaction = await this.getTransaction(signatureInfo.signature);
          
          if (!transaction || transaction.meta?.err) {
            continue;
          }

          // Check token transfers in the transaction
          const tokenTransfers = transaction.meta.postTokenBalances || [];
          
          for (const transfer of tokenTransfers) {
            if (transfer.mint === this.config.mworTokenMint &&
                transfer.owner === walletAddress &&
                transfer.uiTokenAmount.uiAmount >= expectedAmount) {
              
              return {
                found: true,
                transactionHash: signatureInfo.signature,
                actualAmount: transfer.uiTokenAmount.uiAmount
              };
            }
          }
        } catch (error) {
          this.logger.warn(`Error checking transaction ${signatureInfo.signature}:`, error);
          continue;
        }
      }

      return { found: false };
    } catch (error) {
      this.logger.error(`Failed to check for incoming transfer:`, error);
      throw new BlockchainError(
        `Failed to check for incoming transfer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TRANSFER_CHECK_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get the current slot height (for tracking blockchain progress)
   */
  async getCurrentSlot(): Promise<number> {
    try {
      return await this.connection.getSlot();
    } catch (error) {
      this.logger.error('Failed to get current slot:', error);
      throw new BlockchainError(
        `Failed to get current slot: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SLOT_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if the service is connected to the blockchain
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.connection.getSlot();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get network statistics
   */
  async getNetworkStats(): Promise<{
    slot: number;
    blockHeight: number;
    epochInfo: any;
  }> {
    try {
      const [slot, blockHeight, epochInfo] = await Promise.all([
        this.connection.getSlot(),
        this.connection.getBlockHeight(),
        this.connection.getEpochInfo()
      ]);

      return { slot, blockHeight, epochInfo };
    } catch (error) {
      this.logger.error('Failed to get network stats:', error);
      throw new BlockchainError(
        `Failed to get network stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }
}