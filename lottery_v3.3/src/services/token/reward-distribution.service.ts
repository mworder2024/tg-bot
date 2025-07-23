import { TokenService, TokenReward, RewardCalculation } from './token.service.js';
import { SolanaService } from '../../blockchain/solana-service.js';
import { BlockchainConfig, TransactionResult } from '../../types/blockchain.js';
import winston from 'winston';
import * as crypto from 'crypto';

export interface DistributionBatch {
  id: string;
  rewards: TokenReward[];
  totalAmount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  transactionHashes: string[];
  failedTransfers: {
    userId: string;
    walletAddress: string;
    amount: number;
    error: string;
    retryCount: number;
  }[];
  retryPolicy: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
}

export interface DistributionRule {
  name: string;
  type: 'percentage' | 'fixed' | 'tiered';
  enabled: boolean;
  parameters: {
    percentage?: number;
    fixedAmount?: number;
    tiers?: Array<{
      threshold: number;
      multiplier: number;
    }>;
  };
  conditions: {
    minAccuracy?: number;
    minStreak?: number;
    difficulties?: string[];
    timeWindow?: number;
  };
}

export interface DistributionAnalytics {
  period: 'hourly' | 'daily' | 'weekly' | 'monthly';
  timeRange: {
    start: Date;
    end: Date;
  };
  metrics: {
    totalDistributed: number;
    totalTransactions: number;
    averageReward: number;
    successRate: number;
    uniqueRecipients: number;
    topRewardType: string;
    peakHour: number;
    failureReasons: { [reason: string]: number };
  };
  trends: {
    distributionTrend: number[]; // Daily/hourly amounts
    participationTrend: number[]; // User counts
    efficiencyTrend: number[]; // Success rates
  };
}

export class RewardDistributionService {
  private tokenService: TokenService;
  private solanaService: SolanaService;
  private config: BlockchainConfig;
  private logger: winston.Logger;
  
  // Distribution management
  private distributionBatches: Map<string, DistributionBatch> = new Map();
  private distributionRules: Map<string, DistributionRule> = new Map();
  private processingQueue: DistributionBatch[] = [];
  
  // Monitoring and analytics
  private distributionHistory: TokenReward[] = [];
  private processingInterval: NodeJS.Timeout | null = null;
  private analyticsInterval: NodeJS.Timeout | null = null;
  
  // Performance tracking
  private performanceMetrics = {
    totalProcessed: 0,
    totalFailed: 0,
    averageProcessingTime: 0,
    lastProcessingTime: new Date(),
    throughputPerMinute: 0
  };

  constructor(
    tokenService: TokenService,
    solanaService: SolanaService,
    config: BlockchainConfig,
    logger: winston.Logger
  ) {
    this.tokenService = tokenService;
    this.solanaService = solanaService;
    this.config = config;
    this.logger = logger;
    
    this.initializeDefaultRules();
  }

  /**
   * Initialize the distribution service
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Reward Distribution Service...');
    
    try {
      // Start background processing
      this.startBackgroundProcessing();
      
      // Load any pending batches from storage (in production)
      await this.loadPendingBatches();
      
      this.logger.info('Reward Distribution Service initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize distribution service:', error);
      throw error;
    }
  }

  /**
   * Shutdown the distribution service
   */
  shutdown(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    if (this.analyticsInterval) {
      clearInterval(this.analyticsInterval);
      this.analyticsInterval = null;
    }
    
    this.logger.info('Reward Distribution Service shutdown complete');
  }

  /**
   * Create and queue a reward distribution batch
   */
  async createDistributionBatch(
    rewards: TokenReward[],
    ruleName?: string
  ): Promise<DistributionBatch> {
    try {
      // Apply distribution rules if specified
      if (ruleName && this.distributionRules.has(ruleName)) {
        rewards = await this.applyDistributionRule(rewards, ruleName);
      }
      
      // Calculate total amount
      const totalAmount = rewards.reduce((sum, reward) => sum + reward.amount, 0);
      
      // Create batch
      const batch: DistributionBatch = {
        id: this.generateBatchId(),
        rewards,
        totalAmount,
        status: 'pending',
        createdAt: new Date(),
        transactionHashes: [],
        failedTransfers: [],
        retryPolicy: {
          maxRetries: 3,
          retryDelay: 30000, // 30 seconds
          backoffMultiplier: 2
        }
      };
      
      // Store batch
      this.distributionBatches.set(batch.id, batch);
      this.processingQueue.push(batch);
      
      this.logger.info(
        `Distribution batch created: ${batch.id} with ${rewards.length} rewards (${totalAmount} MWOR)`
      );
      
      return batch;
      
    } catch (error) {
      this.logger.error('Failed to create distribution batch:', error);
      throw error;
    }
  }

  /**
   * Process quiz completion rewards with advanced calculation
   */
  async processQuizRewards(
    quizResults: Array<{
      userId: string;
      username: string;
      walletAddress: string;
      quizId: string;
      accuracy: number;
      difficulty: 'easy' | 'medium' | 'hard';
      completionTime: number;
      streak: number;
      isPersonalBest: boolean;
    }>
  ): Promise<DistributionBatch> {
    try {
      const rewards: TokenReward[] = [];
      
      for (const result of quizResults) {
        // Calculate time bonus (faster completion = higher bonus)
        const timeBonus = this.calculateTimeBonus(result.completionTime, result.difficulty);
        
        // Calculate base reward using TokenService
        const calculation = this.tokenService.calculateQuizReward(
          result.accuracy,
          result.difficulty,
          result.streak,
          timeBonus
        );
        
        // Additional bonuses
        let finalAmount = calculation.finalAmount;
        
        // Personal best bonus (20% extra)
        if (result.isPersonalBest) {
          finalAmount = Math.floor(finalAmount * 1.2);
        }
        
        // Create reward
        const reward: TokenReward = {
          userId: result.userId,
          username: result.username,
          walletAddress: result.walletAddress,
          amount: finalAmount,
          rewardType: 'quiz_completion',
          metadata: {
            quizId: result.quizId,
            difficulty: result.difficulty,
            accuracy: result.accuracy,
            streak: result.streak
          },
          timestamp: new Date(),
          status: 'pending'
        };
        
        rewards.push(reward);
      }
      
      // Create batch with quiz distribution rule
      return await this.createDistributionBatch(rewards, 'quiz_completion');
      
    } catch (error) {
      this.logger.error('Failed to process quiz rewards:', error);
      throw error;
    }
  }

  /**
   * Process daily and achievement rewards
   */
  async processDailyRewards(
    eligibleUsers: Array<{
      userId: string;
      username: string;
      walletAddress: string;
      dailyStreakDays: number;
      achievementType?: string;
    }>
  ): Promise<DistributionBatch> {
    try {
      const rewards: TokenReward[] = [];
      
      for (const user of eligibleUsers) {
        let amount = 0;
        let rewardType: TokenReward['rewardType'] = 'daily_bonus';
        
        // Daily streak rewards
        if (user.dailyStreakDays > 0) {
          amount = this.calculateDailyStreakReward(user.dailyStreakDays);
        }
        
        // Achievement rewards
        if (user.achievementType) {
          amount += this.calculateAchievementReward(user.achievementType);
          rewardType = 'achievement';
        }
        
        if (amount > 0) {
          const reward: TokenReward = {
            userId: user.userId,
            username: user.username,
            walletAddress: user.walletAddress,
            amount,
            rewardType,
            metadata: {
              streak: user.dailyStreakDays,
              achievementType: user.achievementType
            },
            timestamp: new Date(),
            status: 'pending'
          };
          
          rewards.push(reward);
        }
      }
      
      return await this.createDistributionBatch(rewards, 'daily_rewards');
      
    } catch (error) {
      this.logger.error('Failed to process daily rewards:', error);
      throw error;
    }
  }

  /**
   * Process bulk distribution with transaction batching
   */
  async processBulkDistribution(
    batchId: string
  ): Promise<{ success: boolean; results: TransactionResult[] }> {
    try {
      const batch = this.distributionBatches.get(batchId);
      if (!batch || batch.status !== 'pending') {
        throw new Error(`Invalid batch ID or batch not ready: ${batchId}`);
      }
      
      batch.status = 'processing';
      batch.processedAt = new Date();
      this.distributionBatches.set(batchId, batch);
      
      const results: TransactionResult[] = [];
      const batchSize = 5; // Process 5 transactions at a time
      
      // Process rewards in batches to avoid rate limiting
      for (let i = 0; i < batch.rewards.length; i += batchSize) {
        const rewardBatch = batch.rewards.slice(i, i + batchSize);
        
        // Process rewards in parallel within each batch
        const batchPromises = rewardBatch.map(async (reward) => {
          try {
            const result = await this.solanaService.transferMworTokens(
              this.getDistributionKeypair(),
              reward.walletAddress,
              reward.amount
            );
            
            if (result.success && result.transactionHash) {
              reward.status = 'completed';
              reward.transactionHash = result.transactionHash;
              batch.transactionHashes.push(result.transactionHash);
              
              this.logger.info(
                `Reward distributed to ${reward.userId}: ${reward.amount} MWOR, tx: ${result.transactionHash}`
              );
            } else {
              reward.status = 'failed';
              batch.failedTransfers.push({
                userId: reward.userId,
                walletAddress: reward.walletAddress,
                amount: reward.amount,
                error: result.error || 'Unknown error',
                retryCount: 0
              });
            }
            
            return result;
            
          } catch (error) {
            reward.status = 'failed';
            batch.failedTransfers.push({
              userId: reward.userId,
              walletAddress: reward.walletAddress,
              amount: reward.amount,
              error: error instanceof Error ? error.message : 'Unknown error',
              retryCount: 0
            });
            
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Delay between batches to avoid rate limiting
        if (i + batchSize < batch.rewards.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Update batch status
      const successCount = results.filter(r => r.success).length;
      batch.status = successCount === batch.rewards.length ? 'completed' : 'failed';
      batch.completedAt = new Date();
      
      // Store distribution history
      this.distributionHistory.push(...batch.rewards.filter(r => r.status === 'completed'));
      
      // Update performance metrics
      this.updatePerformanceMetrics(batch);
      
      this.distributionBatches.set(batchId, batch);
      
      this.logger.info(
        `Batch ${batchId} processed: ${successCount}/${batch.rewards.length} successful`
      );
      
      return {
        success: successCount > 0,
        results
      };
      
    } catch (error) {
      this.logger.error(`Failed to process bulk distribution ${batchId}:`, error);
      throw error;
    }
  }

  /**
   * Retry failed transfers in a batch
   */
  async retryFailedTransfers(batchId: string): Promise<boolean> {
    try {
      const batch = this.distributionBatches.get(batchId);
      if (!batch) {
        return false;
      }
      
      const retryableFailures = batch.failedTransfers.filter(
        failure => failure.retryCount < batch.retryPolicy.maxRetries
      );
      
      if (retryableFailures.length === 0) {
        return false;
      }
      
      this.logger.info(`Retrying ${retryableFailures.length} failed transfers for batch ${batchId}`);
      
      for (const failure of retryableFailures) {
        try {
          const delay = batch.retryPolicy.retryDelay * 
            Math.pow(batch.retryPolicy.backoffMultiplier, failure.retryCount);
          
          await new Promise(resolve => setTimeout(resolve, delay));
          
          const result = await this.solanaService.transferMworTokens(
            this.getDistributionKeypair(),
            failure.walletAddress,
            failure.amount
          );
          
          if (result.success && result.transactionHash) {
            // Remove from failed transfers
            const index = batch.failedTransfers.indexOf(failure);
            batch.failedTransfers.splice(index, 1);
            
            // Add to successful transactions
            batch.transactionHashes.push(result.transactionHash);
            
            this.logger.info(
              `Retry successful for user ${failure.userId}: tx ${result.transactionHash}`
            );
          } else {
            failure.retryCount++;
            failure.error = result.error || 'Retry failed';
          }
          
        } catch (error) {
          failure.retryCount++;
          failure.error = error instanceof Error ? error.message : 'Retry error';
        }
      }
      
      this.distributionBatches.set(batchId, batch);
      return true;
      
    } catch (error) {
      this.logger.error(`Failed to retry failed transfers for batch ${batchId}:`, error);
      return false;
    }
  }

  /**
   * Generate distribution analytics
   */
  generateAnalytics(
    period: 'hourly' | 'daily' | 'weekly' | 'monthly',
    startDate?: Date,
    endDate?: Date
  ): DistributionAnalytics {
    const now = new Date();
    const start = startDate || this.getTimeRangeStart(period, now);
    const end = endDate || now;
    
    const relevantRewards = this.distributionHistory.filter(
      reward => reward.timestamp >= start && reward.timestamp <= end
    );
    
    const totalDistributed = relevantRewards.reduce((sum, r) => sum + r.amount, 0);
    const uniqueRecipients = new Set(relevantRewards.map(r => r.userId)).size;
    
    // Calculate success rate
    const totalAttempts = relevantRewards.length;
    const successfulTransfers = relevantRewards.filter(r => r.status === 'completed').length;
    const successRate = totalAttempts > 0 ? successfulTransfers / totalAttempts : 0;
    
    // Find most common reward type
    const rewardTypeCounts = new Map<string, number>();
    relevantRewards.forEach(reward => {
      const count = rewardTypeCounts.get(reward.rewardType) || 0;
      rewardTypeCounts.set(reward.rewardType, count + 1);
    });
    const topRewardType = Array.from(rewardTypeCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';
    
    // Calculate peak hour
    const hourCounts = new Array(24).fill(0);
    relevantRewards.forEach(reward => {
      const hour = reward.timestamp.getHours();
      hourCounts[hour]++;
    });
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    
    // Generate trend data
    const trends = this.generateTrendData(relevantRewards, period, start, end);
    
    return {
      period,
      timeRange: { start, end },
      metrics: {
        totalDistributed,
        totalTransactions: relevantRewards.length,
        averageReward: totalDistributed / Math.max(relevantRewards.length, 1),
        successRate,
        uniqueRecipients,
        topRewardType,
        peakHour,
        failureReasons: this.getFailureReasons()
      },
      trends
    };
  }

  /**
   * Get distribution batch status
   */
  getBatchStatus(batchId: string): DistributionBatch | null {
    return this.distributionBatches.get(batchId) || null;
  }

  /**
   * Get all batches with optional filtering
   */
  getAllBatches(
    status?: DistributionBatch['status'],
    limit: number = 50
  ): DistributionBatch[] {
    let batches = Array.from(this.distributionBatches.values());
    
    if (status) {
      batches = batches.filter(batch => batch.status === status);
    }
    
    return batches
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /**
   * Initialize default distribution rules
   */
  private initializeDefaultRules(): void {
    // Quiz completion rule
    this.distributionRules.set('quiz_completion', {
      name: 'Quiz Completion',
      type: 'tiered',
      enabled: true,
      parameters: {
        tiers: [
          { threshold: 90, multiplier: 1.5 }, // 90%+ accuracy
          { threshold: 80, multiplier: 1.3 }, // 80%+ accuracy
          { threshold: 70, multiplier: 1.1 }, // 70%+ accuracy
        ]
      },
      conditions: {
        minAccuracy: 50,
        difficulties: ['easy', 'medium', 'hard']
      }
    });
    
    // Daily rewards rule
    this.distributionRules.set('daily_rewards', {
      name: 'Daily Rewards',
      type: 'fixed',
      enabled: true,
      parameters: {
        fixedAmount: 50
      },
      conditions: {
        timeWindow: 24 * 60 * 60 * 1000 // 24 hours
      }
    });
    
    // Achievement rule
    this.distributionRules.set('achievements', {
      name: 'Achievements',
      type: 'tiered',
      enabled: true,
      parameters: {
        tiers: [
          { threshold: 1, multiplier: 1.0 }, // Bronze
          { threshold: 2, multiplier: 2.0 }, // Silver
          { threshold: 3, multiplier: 3.0 }, // Gold
        ]
      },
      conditions: {}
    });
  }

  /**
   * Apply distribution rule to rewards
   */
  private async applyDistributionRule(
    rewards: TokenReward[],
    ruleName: string
  ): Promise<TokenReward[]> {
    const rule = this.distributionRules.get(ruleName);
    if (!rule || !rule.enabled) {
      return rewards;
    }
    
    return rewards.map(reward => {
      let modifiedAmount = reward.amount;
      
      switch (rule.type) {
        case 'percentage':
          if (rule.parameters.percentage) {
            modifiedAmount = Math.floor(reward.amount * (1 + rule.parameters.percentage / 100));
          }
          break;
          
        case 'fixed':
          if (rule.parameters.fixedAmount) {
            modifiedAmount = rule.parameters.fixedAmount;
          }
          break;
          
        case 'tiered':
          if (rule.parameters.tiers && reward.metadata?.accuracy) {
            const tier = rule.parameters.tiers.find(
              t => reward.metadata!.accuracy! >= t.threshold
            );
            if (tier) {
              modifiedAmount = Math.floor(reward.amount * tier.multiplier);
            }
          }
          break;
      }
      
      return { ...reward, amount: modifiedAmount };
    });
  }

  /**
   * Calculate time bonus for quiz completion
   */
  private calculateTimeBonus(completionTime: number, difficulty: string): number {
    const targetTimes = {
      easy: 60, // 1 minute per question
      medium: 90, // 1.5 minutes per question
      hard: 120 // 2 minutes per question
    };
    
    const target = targetTimes[difficulty as keyof typeof targetTimes] || 90;
    if (completionTime < target) {
      const timeRatio = completionTime / target;
      return Math.max(0, (1 - timeRatio) * 0.25); // Up to 25% bonus
    }
    
    return 0;
  }

  /**
   * Calculate daily streak reward
   */
  private calculateDailyStreakReward(streakDays: number): number {
    const baseReward = 50;
    const streakBonus = Math.min(streakDays * 5, 200); // Max 200 bonus
    return baseReward + streakBonus;
  }

  /**
   * Calculate achievement reward
   */
  private calculateAchievementReward(achievementType: string): number {
    const achievements = {
      'first_quiz': 100,
      'perfect_score': 200,
      'speed_demon': 150,
      'knowledge_master': 300,
      'daily_warrior': 100,
      'week_champion': 500
    };
    
    return achievements[achievementType as keyof typeof achievements] || 50;
  }

  /**
   * Get distribution keypair (bot wallet for rewards)
   */
  private getDistributionKeypair(): any {
    // In production, this would use the bot's wallet for token distribution
    // For now, return a placeholder
    return {
      publicKey: { toString: () => 'bot-wallet-address' },
      secretKey: new Uint8Array(64)
    };
  }

  /**
   * Start background processing
   */
  private startBackgroundProcessing(): void {
    // Process queued batches every 30 seconds
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueuedBatches();
      } catch (error) {
        this.logger.error('Error in batch processing:', error);
      }
    }, 30000);
    
    // Generate analytics every hour
    this.analyticsInterval = setInterval(() => {
      try {
        this.updateAnalytics();
      } catch (error) {
        this.logger.error('Error updating analytics:', error);
      }
    }, 3600000);
  }

  /**
   * Process queued batches
   */
  private async processQueuedBatches(): Promise<void> {
    while (this.processingQueue.length > 0) {
      const batch = this.processingQueue.shift();
      if (batch && batch.status === 'pending') {
        try {
          await this.processBulkDistribution(batch.id);
        } catch (error) {
          this.logger.error(`Failed to process batch ${batch.id}:`, error);
          batch.status = 'failed';
          this.distributionBatches.set(batch.id, batch);
        }
      }
    }
  }

  /**
   * Load pending batches from storage
   */
  private async loadPendingBatches(): Promise<void> {
    // In production, this would load from database
    // For now, this is a placeholder
    this.logger.debug('Loading pending batches from storage...');
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(batch: DistributionBatch): void {
    const successful = batch.rewards.filter(r => r.status === 'completed').length;
    const failed = batch.rewards.filter(r => r.status === 'failed').length;
    
    this.performanceMetrics.totalProcessed += successful;
    this.performanceMetrics.totalFailed += failed;
    this.performanceMetrics.lastProcessingTime = new Date();
    
    if (batch.processedAt && batch.completedAt) {
      const processingTime = batch.completedAt.getTime() - batch.processedAt.getTime();
      this.performanceMetrics.averageProcessingTime = 
        (this.performanceMetrics.averageProcessingTime + processingTime) / 2;
    }
  }

  /**
   * Generate trend data for analytics
   */
  private generateTrendData(
    rewards: TokenReward[],
    period: string,
    start: Date,
    end: Date
  ): { distributionTrend: number[]; participationTrend: number[]; efficiencyTrend: number[] } {
    // Simplified trend generation
    const bucketCount = period === 'hourly' ? 24 : period === 'daily' ? 7 : 30;
    const distributionTrend = new Array(bucketCount).fill(0);
    const participationTrend = new Array(bucketCount).fill(0);
    const efficiencyTrend = new Array(bucketCount).fill(1);
    
    // This would be more sophisticated in production
    rewards.forEach((reward, index) => {
      const bucket = index % bucketCount;
      distributionTrend[bucket] += reward.amount;
      participationTrend[bucket]++;
    });
    
    return { distributionTrend, participationTrend, efficiencyTrend };
  }

  /**
   * Get failure reasons summary
   */
  private getFailureReasons(): { [reason: string]: number } {
    const reasons: { [reason: string]: number } = {};
    
    for (const batch of this.distributionBatches.values()) {
      for (const failure of batch.failedTransfers) {
        reasons[failure.error] = (reasons[failure.error] || 0) + 1;
      }
    }
    
    return reasons;
  }

  /**
   * Get time range start for analytics
   */
  private getTimeRangeStart(period: string, end: Date): Date {
    const start = new Date(end);
    
    switch (period) {
      case 'hourly':
        start.setHours(start.getHours() - 24);
        break;
      case 'daily':
        start.setDate(start.getDate() - 7);
        break;
      case 'weekly':
        start.setDate(start.getDate() - 30);
        break;
      case 'monthly':
        start.setMonth(start.getMonth() - 12);
        break;
    }
    
    return start;
  }

  /**
   * Update analytics cache
   */
  private updateAnalytics(): void {
    // Generate and cache analytics for different periods
    // This would store results in Redis or database in production
    this.logger.debug('Updating distribution analytics cache...');
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `batch_${timestamp}_${random}`;
  }

  /**
   * Get service performance metrics
   */
  getPerformanceMetrics(): typeof this.performanceMetrics {
    return { ...this.performanceMetrics };
  }
}