import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ParsedTransactionWithMeta,
  ConfirmedSignatureInfo,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getMint,
  getAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { Redis } from 'ioredis';
import { StructuredLogger } from '../../utils/structured-logger';
import { decryptPrivateKey } from '../../utils/crypto';

export interface TransactionSearchParams {
  from: string;
  to: string;
  amount: number;
  after: Date;
  token: string;
}

export interface FoundTransaction {
  signature: string;
  from: string;
  to: string;
  amount: number;
  token: string;
  timestamp: number;
  confirmations: number;
}

export class SolanaService {
  private connection: Connection;
  private botKeypair: Keypair;
  private treasuryKeypair: Keypair;
  private readonly CONFIRMATION_THRESHOLD = 32;

  constructor(
    private readonly rpcUrl: string,
    private readonly redis: Redis,
    private readonly logger: StructuredLogger
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    
    // Initialize keypairs from encrypted private keys
    const botPrivateKey = decryptPrivateKey(
      process.env.BOT_WALLET_PRIVATE_KEY!,
      process.env.WALLET_ENCRYPTION_KEY!
    );
    const treasuryPrivateKey = decryptPrivateKey(
      process.env.TREASURY_WALLET_PRIVATE_KEY!,
      process.env.WALLET_ENCRYPTION_KEY!
    );

    this.botKeypair = Keypair.fromSecretKey(Buffer.from(botPrivateKey, 'base64'));
    this.treasuryKeypair = Keypair.fromSecretKey(Buffer.from(treasuryPrivateKey, 'base64'));
  }

  /**
   * Get bot wallet public key
   */
  getBotWalletAddress(): string {
    return this.botKeypair.publicKey.toBase58();
  }

  /**
   * Get treasury wallet public key
   */
  getTreasuryWalletAddress(): string {
    return this.treasuryKeypair.publicKey.toBase58();
  }

  /**
   * Find a specific transaction matching criteria
   */
  async findTransaction(params: TransactionSearchParams): Promise<FoundTransaction | null> {
    const logContext = this.logger.createContext();

    try {
      const { from, to, amount, after, token } = params;
      
      // Get recent signatures for the destination address
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(to),
        { limit: 100 }
      );

      // Filter signatures after the specified date
      const relevantSignatures = signatures.filter(
        sig => sig.blockTime && new Date(sig.blockTime * 1000) > after
      );

      // Check each transaction
      for (const sigInfo of relevantSignatures) {
        const tx = await this.connection.getParsedTransaction(
          sigInfo.signature,
          { maxSupportedTransactionVersion: 0 }
        );

        if (!tx || !tx.meta) continue;

        // Check if this is a token transfer
        const tokenTransfer = this.parseTokenTransfer(tx, token);
        
        if (
          tokenTransfer &&
          tokenTransfer.from === from &&
          tokenTransfer.to === to &&
          Math.abs(tokenTransfer.amount - amount) < 0.000001 // Allow for rounding
        ) {
          const currentSlot = await this.connection.getSlot();
          const confirmations = currentSlot - tx.slot;

          this.logger.logBlockchainEvent(logContext, {
            event: 'transaction_found',
            transactionId: sigInfo.signature,
            metadata: {
              from,
              to,
              amount,
              confirmations
            }
          });

          return {
            signature: sigInfo.signature,
            from: tokenTransfer.from,
            to: tokenTransfer.to,
            amount: tokenTransfer.amount,
            token: tokenTransfer.token,
            timestamp: tx.blockTime || 0,
            confirmations
          };
        }
      }

      return null;
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'findTransaction',
        params
      });
      throw error;
    }
  }

  /**
   * Parse token transfer from transaction
   */
  private parseTokenTransfer(
    tx: ParsedTransactionWithMeta,
    tokenMint: string
  ): { from: string; to: string; amount: number; token: string } | null {
    if (!tx.meta?.postTokenBalances || !tx.meta?.preTokenBalances) {
      return null;
    }

    // Find token balance changes
    for (let i = 0; i < tx.meta.postTokenBalances.length; i++) {
      const postBalance = tx.meta.postTokenBalances[i];
      
      if (postBalance.mint !== tokenMint) continue;

      // Find corresponding pre-balance
      const preBalance = tx.meta.preTokenBalances.find(
        pre => pre.accountIndex === postBalance.accountIndex
      );

      if (!preBalance) continue;

      const change = (postBalance.uiTokenAmount.uiAmount || 0) - 
                    (preBalance.uiTokenAmount.uiAmount || 0);

      if (change > 0) {
        // This account received tokens
        const fromAccount = tx.meta.preTokenBalances.find(
          pre => pre.mint === tokenMint && 
                 pre.accountIndex !== postBalance.accountIndex &&
                 (pre.uiTokenAmount.uiAmount || 0) > (tx.meta!.postTokenBalances!.find(
                   post => post.accountIndex === pre.accountIndex
                 )?.uiTokenAmount.uiAmount || 0)
        );

        if (fromAccount && fromAccount.owner) {
          return {
            from: fromAccount.owner,
            to: postBalance.owner!,
            amount: change,
            token: tokenMint
          };
        }
      }
    }

    return null;
  }

  /**
   * Send tokens from bot wallet
   */
  async sendTokens(
    to: string,
    amount: number,
    tokenMint: string
  ): Promise<string> {
    const logContext = this.logger.createContext();

    try {
      const toPublicKey = new PublicKey(to);
      const mintPublicKey = new PublicKey(tokenMint);

      // Get token accounts
      const fromTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        this.botKeypair.publicKey
      );

      const toTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        toPublicKey
      );

      // Get mint info for decimals
      const mintInfo = await getMint(this.connection, mintPublicKey);
      const amountInDecimals = amount * Math.pow(10, mintInfo.decimals);

      // Create transfer instruction
      const transferInstruction = createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        this.botKeypair.publicKey,
        amountInDecimals
      );

      // Create and send transaction
      const transaction = new Transaction().add(transferInstruction);
      
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.botKeypair],
        {
          commitment: 'confirmed'
        }
      );

      this.logger.logBlockchainEvent(logContext, {
        event: 'tokens_sent',
        transactionId: signature,
        metadata: {
          to,
          amount,
          token: tokenMint
        }
      });

      return signature;
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'sendTokens',
        to,
        amount,
        tokenMint
      });
      throw error;
    }
  }

  /**
   * Send treasury distribution
   */
  async sendToTreasury(
    amount: number,
    tokenMint: string,
    referenceGameId?: string
  ): Promise<string> {
    const logContext = this.logger.createContext();

    try {
      const signature = await this.sendTokens(
        this.treasuryKeypair.publicKey.toBase58(),
        amount,
        tokenMint
      );

      this.logger.logBlockchainEvent(logContext, {
        event: 'treasury_distribution',
        transactionId: signature,
        metadata: {
          amount,
          token: tokenMint,
          gameId: referenceGameId
        }
      });

      return signature;
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'sendToTreasury',
        amount,
        tokenMint
      });
      throw error;
    }
  }

  /**
   * Get token balance for an address
   */
  async getTokenBalance(
    address: string,
    tokenMint: string
  ): Promise<number> {
    try {
      const publicKey = new PublicKey(address);
      const mintPublicKey = new PublicKey(tokenMint);

      const tokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        publicKey
      );

      try {
        const account = await getAccount(this.connection, tokenAccount);
        const mintInfo = await getMint(this.connection, mintPublicKey);
        
        return Number(account.amount) / Math.pow(10, mintInfo.decimals);
      } catch (error) {
        if (error instanceof TokenAccountNotFoundError) {
          return 0;
        }
        throw error;
      }
    } catch (error) {
      this.logger.logError(this.logger.createContext(), error as Error, {
        operation: 'getTokenBalance',
        address,
        tokenMint
      });
      throw error;
    }
  }

  /**
   * Monitor address for incoming transactions
   */
  async monitorAddress(
    address: string,
    callback: (tx: FoundTransaction) => void
  ): Promise<() => void> {
    const publicKey = new PublicKey(address);
    
    const subscriptionId = this.connection.onAccountChange(
      publicKey,
      async (accountInfo, context) => {
        // Get recent signatures
        const signatures = await this.connection.getSignaturesForAddress(
          publicKey,
          { limit: 1 }
        );

        if (signatures.length > 0) {
          const tx = await this.connection.getParsedTransaction(
            signatures[0].signature,
            { maxSupportedTransactionVersion: 0 }
          );

          if (tx && tx.meta) {
            const tokenTransfer = this.parseTokenTransfer(
              tx,
              process.env.MWOR_TOKEN_MINT!
            );

            if (tokenTransfer) {
              callback({
                signature: signatures[0].signature,
                from: tokenTransfer.from,
                to: tokenTransfer.to,
                amount: tokenTransfer.amount,
                token: tokenTransfer.token,
                timestamp: tx.blockTime || 0,
                confirmations: 0
              });
            }
          }
        }
      }
    );

    // Return cleanup function
    return () => {
      this.connection.removeAccountChangeListener(subscriptionId);
    };
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForConfirmation(
    signature: string,
    requiredConfirmations: number = this.CONFIRMATION_THRESHOLD
  ): Promise<boolean> {
    const logContext = this.logger.createContext();

    try {
      const startTime = Date.now();
      const timeout = 60000; // 60 seconds

      while (Date.now() - startTime < timeout) {
        const status = await this.connection.getSignatureStatus(signature);
        
        if (status.value?.confirmationStatus === 'finalized') {
          return true;
        }

        if (status.value?.confirmations && status.value.confirmations >= requiredConfirmations) {
          return true;
        }

        if (status.value?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }

        // Wait 1 second before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      throw new Error('Transaction confirmation timeout');
    } catch (error) {
      this.logger.logError(logContext, error as Error, {
        operation: 'waitForConfirmation',
        signature
      });
      throw error;
    }
  }
}