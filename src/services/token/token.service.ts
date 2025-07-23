import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionSignature,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  createMintToInstruction
} from '@solana/spl-token';
import { 
  BlockchainConfig, 
  TransactionResult, 
  BlockchainError,
  WalletBalance 
} from '../../types/blockchain.js';
import { SolanaService } from '../../blockchain/solana-service.js';
import winston from 'winston';
import * as crypto from 'crypto';

export interface TokenReward {
  userId: string;
  username: string;
  walletAddress: string;
  amount: number;
  rewardType: 'quiz_completion' | 'bonus_round' | 'daily_bonus' | 'referral' | 'achievement';
  metadata?: {
    quizId?: string;
    difficulty?: string;
    accuracy?: number;
    streak?: number;
    achievementType?: string;
  };
  timestamp: Date;
  transactionHash?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface TokenTransaction {
  id: string;
  userId: string;
  type: 'reward' | 'transfer' | 'burn' | 'mint';
  amount: number;
  fromAddress?: string;
  toAddress: string;
  transactionHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: Date;
  blockHeight?: number;
  confirmationTime?: Date;
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
}

export interface TokenBalance {
  userId: string;
  walletAddress: string;
  balance: number;
  lockedBalance: number; // For pending transactions
  lastUpdated: Date;
  transactionHistory: TokenTransaction[];
}

export interface RewardCalculation {
  baseReward: number;
  bonusMultiplier: number;
  finalAmount: number;
  factors: {
    accuracy?: number;
    streak?: number;
    difficulty?: string;
    timeBonus?: number;
  };
}

export interface TokenLeaderboard {
  period: 'daily' | 'weekly' | 'monthly' | 'all_time';
  entries: {
    rank: number;
    userId: string;
    username: string;
    totalEarned: number;
    totalTransactions: number;
    averageReward: number;
  }[];
  generatedAt: Date;
}

export interface AntiFraudRule {
  name: string;
  enabled: boolean;
  maxRewardsPerHour: number;
  maxRewardsPerDay: number;
  suspiciousPatternThreshold: number;
  cooldownPeriod: number; // in milliseconds
}

export interface SecurityAudit {
  userId: string;
  action: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  riskScore: number;
  flagged: boolean;
  reason?: string;
}

export class TokenService {
  private solanaService: SolanaService;
  private connection: Connection;
  private config: BlockchainConfig;
  private logger: winston.Logger;
  private botKeypair: Keypair;
  private treasuryKeypair: Keypair;
  
  // In-memory caches (in production, use Redis)
  private balanceCache: Map<string, TokenBalance> = new Map();
  private rewardQueue: Map<string, TokenReward> = new Map();
  private transactionQueue: Map<string, TokenTransaction> = new Map();
  private fraudDetection: Map<string, SecurityAudit[]> = new Map();
  
  // Monitoring intervals
  private processingInterval: NodeJS.Timeout | null = null;
  private auditInterval: NodeJS.Timeout | null = null;
  
  // Anti-fraud configuration
  private fraudRules: AntiFraudRule = {
    name: 'default',
    enabled: true,
    maxRewardsPerHour: 20,
    maxRewardsPerDay: 100,
    suspiciousPatternThreshold: 0.8,
    cooldownPeriod: 300000 // 5 minutes
  };

  constructor(
    solanaService: SolanaService,
    config: BlockchainConfig,
    logger: winston.Logger
  ) {
    this.solanaService = solanaService;
    this.connection = solanaService.getConnection();
    this.config = config;
    this.logger = logger;
    
    // Initialize keypairs from config
    this.botKeypair = Keypair.fromSecretKey(
      Buffer.from(config.botWalletPrivateKey, 'base64')
    );
    this.treasuryKeypair = Keypair.fromSecretKey(
      Buffer.from(config.treasuryWalletPrivateKey, 'base64')
    );
  }

  /**
   * Initialize the token service
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing MWOR Token Service...');
    
    try {
      // Verify bot wallet has sufficient SOL for transactions
      const botBalance = await this.solanaService.getWalletBalance(
        this.botKeypair.publicKey.toString()
      );
      
      if (botBalance.solBalance < 0.1 * LAMPORTS_PER_SOL) {
        this.logger.warn('Bot wallet has low SOL balance for transaction fees');
      }
      
      // Start background processing
      this.startBackgroundProcessing();
      
      this.logger.info('MWOR Token Service initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize token service:', error);
      throw new BlockchainError(
        'Token service initialization failed',
        'INIT_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Shutdown the token service
   */
  shutdown(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    if (this.auditInterval) {
      clearInterval(this.auditInterval);
      this.auditInterval = null;
    }
    
    this.logger.info('Token service shutdown complete');
  }

  /**
   * Generate secure token amount within range (1-100,000)
   */
  generateSecureTokenAmount(
    baseAmount: number,
    multiplier: number = 1,
    maxAmount: number = 100000
  ): number {
    // Add cryptographic randomness for fairness
    const randomBytes = crypto.randomBytes(4);
    const randomFactor = randomBytes.readUInt32BE(0) / 0xFFFFFFFF;
    
    // Calculate with variance (±10%)
    const variance = 0.1;
    const varianceAmount = baseAmount * variance * (randomFactor - 0.5) * 2;
    
    const finalAmount = Math.floor((baseAmount + varianceAmount) * multiplier);
    
    // Ensure within valid range
    return Math.max(1, Math.min(finalAmount, maxAmount));
  }

  /**
   * Calculate reward based on quiz performance
   */
  calculateQuizReward(
    accuracy: number,
    difficulty: 'easy' | 'medium' | 'hard',
    streak: number = 0,
    timeBonus: number = 0
  ): RewardCalculation {
    // Base rewards by difficulty
    const baseRewards = {
      easy: 50,
      medium: 100,
      hard: 200
    };
    
    const baseReward = baseRewards[difficulty];
    
    // Calculate bonus multiplier
    let bonusMultiplier = 1;
    
    // Accuracy bonus (up to 50% bonus for perfect score)
    bonusMultiplier += (accuracy / 100) * 0.5;
    
    // Streak bonus (5% per streak, max 100%)
    const streakBonus = Math.min(streak * 0.05, 1.0);
    bonusMultiplier += streakBonus;
    
    // Time bonus (max 25% for quick completion)
    bonusMultiplier += Math.min(timeBonus, 0.25);
    
    const finalAmount = this.generateSecureTokenAmount(baseReward, bonusMultiplier);
    
    return {
      baseReward,
      bonusMultiplier,
      finalAmount,
      factors: {
        accuracy,
        streak,
        difficulty,
        timeBonus
      }
    };
  }

  /**
   * Award tokens for quiz completion
   */
  async awardQuizReward(
    userId: string,
    username: string,
    walletAddress: string,
    quizId: string,
    accuracy: number,
    difficulty: 'easy' | 'medium' | 'hard',
    streak: number = 0,
    timeBonus: number = 0
  ): Promise<TokenReward> {
    try {
      // Anti-fraud check
      const isValid = await this.validateRewardRequest(userId, 'quiz_completion');
      if (!isValid) {
        throw new BlockchainError(
          'Reward request failed anti-fraud validation',
          'FRAUD_DETECTED'
        );
      }
      
      // Calculate reward
      const calculation = this.calculateQuizReward(accuracy, difficulty, streak, timeBonus);
      
      // Create reward record
      const reward: TokenReward = {
        userId,
        username,
        walletAddress,
        amount: calculation.finalAmount,
        rewardType: 'quiz_completion',
        metadata: {
          quizId,
          difficulty,
          accuracy,
          streak
        },
        timestamp: new Date(),
        status: 'pending'
      };
      
      // Queue for processing
      const rewardId = this.generateRewardId(userId);
      this.rewardQueue.set(rewardId, reward);
      
      this.logger.info(
        `Quiz reward queued for user ${userId}: ${calculation.finalAmount} MWOR`
      );
      
      return reward;
      
    } catch (error) {
      this.logger.error(`Failed to award quiz reward for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Award bonus round rewards
   */
  async awardBonusRound(
    participants: Array<{
      userId: string;
      username: string;
      walletAddress: string;
      performance: number; // 0-1 performance score
    }>
  ): Promise<TokenReward[]> {
    const rewards: TokenReward[] = [];
    
    try {
      // Total bonus pool
      const bonusPool = 10000; // MWOR tokens
      
      // Calculate distribution based on performance
      const totalPerformance = participants.reduce((sum, p) => sum + p.performance, 0);
      
      for (const participant of participants) {
        const performanceRatio = participant.performance / totalPerformance;
        const rewardAmount = this.generateSecureTokenAmount(
          bonusPool * performanceRatio,
          1,
          bonusPool * 0.5 // Max 50% of pool for single participant
        );
        
        const reward: TokenReward = {
          userId: participant.userId,
          username: participant.username,
          walletAddress: participant.walletAddress,
          amount: rewardAmount,
          rewardType: 'bonus_round',
          metadata: {
            // performance: participant.performance // Removed as not in metadata type
          },
          timestamp: new Date(),
          status: 'pending'
        };
        
        // Anti-fraud check
        const isValid = await this.validateRewardRequest(participant.userId, 'bonus_round');
        if (isValid) {
          const rewardId = this.generateRewardId(participant.userId);
          this.rewardQueue.set(rewardId, reward);
          rewards.push(reward);
        }
      }
      
      this.logger.info(`Bonus round rewards queued for ${rewards.length} participants`);
      return rewards;
      
    } catch (error) {
      this.logger.error('Failed to award bonus round rewards:', error);
      throw error;
    }
  }

  /**
   * Get user token balance
   */
  async getUserBalance(userId: string, walletAddress: string): Promise<TokenBalance> {
    try {
      // Check cache first
      const cached = this.balanceCache.get(userId);
      if (cached && (Date.now() - cached.lastUpdated.getTime()) < 30000) { // 30s cache
        return cached;
      }
      
      // Get on-chain balance
      const onChainBalance = await this.solanaService.getWalletBalance(walletAddress);
      
      // Calculate locked balance (pending transactions)
      const lockedBalance = Array.from(this.transactionQueue.values())
        .filter(tx => tx.userId === userId && tx.status === 'pending')
        .reduce((sum, tx) => sum + tx.amount, 0);
      
      // Get transaction history (last 100 transactions)
      const transactionHistory = Array.from(this.transactionQueue.values())
        .filter(tx => tx.userId === userId)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 100);
      
      const balance: TokenBalance = {
        userId,
        walletAddress,
        balance: onChainBalance.mworBalance,
        lockedBalance,
        lastUpdated: new Date(),
        transactionHistory
      };
      
      // Update cache
      this.balanceCache.set(userId, balance);
      
      return balance;
      
    } catch (error) {
      this.logger.error(`Failed to get balance for user ${userId}:`, error);
      throw new BlockchainError(
        'Failed to retrieve token balance',
        'BALANCE_ERROR',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Generate token leaderboard
   */
  async generateLeaderboard(
    period: 'daily' | 'weekly' | 'monthly' | 'all_time',
    limit: number = 50
  ): Promise<TokenLeaderboard> {
    try {
      // Calculate time range
      const now = new Date();
      let startTime: Date;
      
      switch (period) {
        case 'daily':
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'weekly':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
          startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(0); // All time
      }
      
      // Aggregate user earnings
      const userEarnings = new Map<string, {
        username: string;
        totalEarned: number;
        totalTransactions: number;
      }>();
      
      // Process completed rewards in time range
      for (const reward of this.rewardQueue.values()) {
        if (reward.status === 'completed' && reward.timestamp >= startTime) {
          const existing = userEarnings.get(reward.userId) || {
            username: reward.username,
            totalEarned: 0,
            totalTransactions: 0
          };
          
          existing.totalEarned += reward.amount;
          existing.totalTransactions += 1;
          userEarnings.set(reward.userId, existing);
        }
      }
      
      // Convert to leaderboard entries
      const entries = Array.from(userEarnings.entries())
        .map(([userId, data]) => ({
          rank: 0, // Will be set after sorting
          userId,
          username: data.username,
          totalEarned: data.totalEarned,
          totalTransactions: data.totalTransactions,
          averageReward: data.totalEarned / data.totalTransactions
        }))
        .sort((a, b) => b.totalEarned - a.totalEarned)
        .slice(0, limit)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      
      return {
        period,
        entries,
        generatedAt: new Date()
      };
      
    } catch (error) {
      this.logger.error(`Failed to generate ${period} leaderboard:`, error);
      throw error;
    }
  }

  /**
   * Get user reward history
   */
  getUserRewardHistory(userId: string, limit: number = 50): TokenReward[] {
    return Array.from(this.rewardQueue.values())
      .filter(reward => reward.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Anti-fraud validation
   */
  private async validateRewardRequest(
    userId: string,
    rewardType: string
  ): Promise<boolean> {
    try {
      if (!this.fraudRules.enabled) {
        return true;
      }
      
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      // Get recent rewards for user
      const recentRewards = Array.from(this.rewardQueue.values())
        .filter(reward => reward.userId === userId);
      
      const hourlyRewards = recentRewards.filter(r => r.timestamp >= hourAgo);
      const dailyRewards = recentRewards.filter(r => r.timestamp >= dayAgo);
      
      // Check rate limits
      if (hourlyRewards.length >= this.fraudRules.maxRewardsPerHour) {
        this.logSecurityEvent(userId, 'RATE_LIMIT_EXCEEDED', 'Hourly limit exceeded', 0.8);
        return false;
      }
      
      if (dailyRewards.length >= this.fraudRules.maxRewardsPerDay) {
        this.logSecurityEvent(userId, 'RATE_LIMIT_EXCEEDED', 'Daily limit exceeded', 0.9);
        return false;
      }
      
      // Check for suspicious patterns
      const riskScore = this.calculateRiskScore(userId, recentRewards);
      if (riskScore >= this.fraudRules.suspiciousPatternThreshold) {
        this.logSecurityEvent(userId, 'SUSPICIOUS_PATTERN', 'High risk score detected', riskScore);
        return false;
      }
      
      return true;
      
    } catch (error) {
      this.logger.error(`Anti-fraud validation failed for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Calculate risk score for user
   */
  private calculateRiskScore(userId: string, recentRewards: TokenReward[]): number {
    let riskScore = 0;
    
    // Check for rapid successive rewards
    const timestamps = recentRewards.map(r => r.timestamp.getTime()).sort();
    for (let i = 1; i < timestamps.length; i++) {
      const timeDiff = timestamps[i] - timestamps[i-1];
      if (timeDiff < 10000) { // Less than 10 seconds apart
        riskScore += 0.2;
      }
    }
    
    // Check for identical reward amounts
    const amounts = recentRewards.map(r => r.amount);
    const uniqueAmounts = new Set(amounts);
    if (amounts.length > 5 && uniqueAmounts.size < amounts.length * 0.3) {
      riskScore += 0.3;
    }
    
    // Check for excessive rewards in short time
    const recentCount = recentRewards.filter(
      r => r.timestamp.getTime() > Date.now() - 300000 // 5 minutes
    ).length;
    if (recentCount > 5) {
      riskScore += 0.4;
    }
    
    return Math.min(riskScore, 1.0);
  }

  /**
   * Log security event
   */
  private logSecurityEvent(
    userId: string,
    action: string,
    reason: string,
    riskScore: number
  ): void {
    const event: SecurityAudit = {
      userId,
      action,
      timestamp: new Date(),
      riskScore,
      flagged: riskScore >= this.fraudRules.suspiciousPatternThreshold,
      reason
    };
    
    const userEvents = this.fraudDetection.get(userId) || [];
    userEvents.push(event);
    this.fraudDetection.set(userId, userEvents);
    
    this.logger.warn(`Security event for user ${userId}: ${action} - ${reason} (risk: ${riskScore})`);
  }

  /**
   * Process reward queue
   */
  private async processRewardQueue(): Promise<void> {
    const pendingRewards = Array.from(this.rewardQueue.entries())
      .filter(([, reward]) => reward.status === 'pending')
      .slice(0, 10); // Process up to 10 at a time
    
    for (const [rewardId, reward] of pendingRewards) {
      try {
        reward.status = 'processing';
        this.rewardQueue.set(rewardId, reward);
        
        // Transfer tokens
        const result = await this.solanaService.transferMworTokens(
          this.botKeypair,
          reward.walletAddress,
          reward.amount
        );
        
        if (result.success && result.transactionHash) {
          reward.status = 'completed';
          reward.transactionHash = result.transactionHash;
          
          this.logger.info(
            `Reward processed for user ${reward.userId}: ${reward.amount} MWOR, tx: ${result.transactionHash}`
          );
        } else {
          reward.status = 'failed';
          this.logger.error(`Reward failed for user ${reward.userId}: ${result.error}`);
        }
        
        this.rewardQueue.set(rewardId, reward);
        
      } catch (error) {
        reward.status = 'failed';
        this.rewardQueue.set(rewardId, reward);
        this.logger.error(`Error processing reward ${rewardId}:`, error);
      }
      
      // Small delay between transactions
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Start background processing
   */
  private startBackgroundProcessing(): void {
    // Process rewards every 30 seconds
    this.processingInterval = setInterval(async () => {
      try {
        await this.processRewardQueue();
      } catch (error) {
        this.logger.error('Error in reward processing:', error);
      }
    }, 30000);
    
    // Clean up old data every hour
    this.auditInterval = setInterval(() => {
      this.cleanupOldData();
    }, 3600000);
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Clean completed rewards older than 7 days
    for (const [rewardId, reward] of this.rewardQueue.entries()) {
      if (reward.status === 'completed' && reward.timestamp < cutoffTime) {
        this.rewardQueue.delete(rewardId);
      }
    }
    
    // Clean old security events
    for (const [userId, events] of this.fraudDetection.entries()) {
      const recentEvents = events.filter(event => event.timestamp >= cutoffTime);
      if (recentEvents.length === 0) {
        this.fraudDetection.delete(userId);
      } else {
        this.fraudDetection.set(userId, recentEvents);
      }
    }
    
    this.logger.info('Cleanup completed: removed old reward and security data');
  }

  /**
   * Generate unique reward ID
   */
  private generateRewardId(userId: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `reward_${timestamp}_${userId}_${random}`;
  }

  /**
   * Get service statistics
   */
  getServiceStats(): {
    totalRewards: number;
    pendingRewards: number;
    completedRewards: number;
    failedRewards: number;
    totalTokensDistributed: number;
    activeUsers: number;
    securityEvents: number;
  } {
    const rewards = Array.from(this.rewardQueue.values());
    const uniqueUsers = new Set(rewards.map(r => r.userId)).size;
    const securityEventCount = Array.from(this.fraudDetection.values())
      .reduce((sum, events) => sum + events.length, 0);
    
    return {
      totalRewards: rewards.length,
      pendingRewards: rewards.filter(r => r.status === 'pending').length,
      completedRewards: rewards.filter(r => r.status === 'completed').length,
      failedRewards: rewards.filter(r => r.status === 'failed').length,
      totalTokensDistributed: rewards
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + r.amount, 0),
      activeUsers: uniqueUsers,
      securityEvents: securityEventCount
    };
  }
}