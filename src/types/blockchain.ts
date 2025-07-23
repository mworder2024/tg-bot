// Blockchain-related type definitions for paid raffle system

export interface UserWallet {
  userId: string;           // Telegram user ID
  walletAddress: string;    // Solana wallet address
  verificationDate: Date;   // When wallet was verified
  isActive: boolean;        // Wallet status
  lastUsed: Date;          // Last payment date
  verificationSignature?: string; // Signature used for verification
}

export interface PaymentRecord {
  paymentId: string;        // Unique payment identifier
  userId: string;           // Telegram user ID
  gameId: string;           // Associated game ID
  amount: number;           // MWOR token amount
  transactionHash?: string; // Solana transaction hash
  status: 'pending' | 'confirmed' | 'failed' | 'refunded' | 'expired';
  timestamp: Date;          // Payment initiation time
  confirmationTime?: Date;  // Blockchain confirmation time
  refundHash?: string;      // Refund transaction hash if applicable
  expiresAt: Date;         // Payment expiration time
  retryCount: number;      // Number of verification retries
}

export interface PaidGameRecord {
  gameId: string;
  isPaid: boolean;          // Payment required flag
  entryFee: number;         // MWOR tokens required
  prizePool: number;        // Total accumulated pool
  systemFee: number;        // 10% for treasury
  distributionHash?: string; // Prize distribution transaction
  payments: PaymentRecord[]; // All payment records for game
  createdAt: Date;
  status: 'waiting_for_payments' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
  minPlayers: number;       // Minimum players required
  maxPlayers: number;       // Maximum players allowed
  paymentDeadline: Date;    // When payment phase ends
}

export interface WinnerInfo {
  userId: string;
  username: string;
  walletAddress: string;
  prizeAmount: number;
  winningNumber?: number;
}

export interface VerificationChallenge {
  userId: string;
  challengeMessage: string;
  timestamp: Date;
  expiresAt: Date;
  isUsed: boolean;
}

export interface PaymentRequest {
  paymentId: string;
  gameId: string;
  userId: string;
  amount: number;
  botWalletAddress: string;
  instructions: string;
  qrCode?: string;
  expiresAt: Date;
}

export interface WalletBalance {
  address: string;
  solBalance: number;       // SOL balance in lamports
  mworBalance: number;      // MWOR token balance
  lastUpdated: Date;
}

export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
  confirmationTime?: Date;
}

export interface DistributionResult {
  success: boolean;
  transactionHashes: string[];
  totalDistributed: number;
  systemFeeCollected: number;
  failedTransfers: {
    userId: string;
    amount: number;
    error: string;
  }[];
}

export interface BlockchainConfig {
  rpcUrl: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet';
  mworTokenMint: string;
  botWalletPrivateKey: string;
  treasuryWalletPrivateKey: string;
  paymentTimeoutMinutes: number;
  minConfirmationCount: number;
  systemFeePercentage: number;
  encryptionKey: string;
}

export interface RefundRequest {
  paymentId: string;
  reason: string;
  requestedBy: string;
  timestamp: Date;
  processed: boolean;
  refundHash?: string;
}

export type PaymentStatus = 'pending' | 'confirmed' | 'failed' | 'refunded' | 'expired';
export type GameStatus = 'waiting_for_payments' | 'ready' | 'in_progress' | 'completed' | 'cancelled';
export type VerificationStatus = 'pending' | 'verified' | 'failed' | 'expired';

// Error types for blockchain operations
export class BlockchainError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'BlockchainError';
  }
}

export class PaymentError extends BlockchainError {
  constructor(
    message: string,
    public paymentId: string,
    originalError?: Error
  ) {
    super(message, 'PAYMENT_ERROR', originalError);
    this.name = 'PaymentError';
  }
}

export class WalletError extends BlockchainError {
  constructor(
    message: string,
    public walletAddress?: string,
    originalError?: Error
  ) {
    super(message, 'WALLET_ERROR', originalError);
    this.name = 'WalletError';
  }
}

export class VerificationError extends BlockchainError {
  constructor(
    message: string,
    public userId: string,
    originalError?: Error
  ) {
    super(message, 'VERIFICATION_ERROR', originalError);
    this.name = 'VerificationError';
  }
}