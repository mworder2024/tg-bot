import { TokenService } from './token.service.js';
import { RewardDistributionService } from './reward-distribution.service.js';
import { quizService, UserQuizStats } from '../quiz.service.js';
// QuizSession type not exported from quiz.service
interface QuizSession {
  sessionId: string;
  userId: string;
  chatId: string;
  score: number;
  answers: Array<{ questionId: string; answer: string; correct: boolean }>;
  startTime: Date;
  endTime?: Date;
}
import { SolanaService } from '../../blockchain/solana-service.js';
import { BlockchainConfig } from '../../types/blockchain.js';
import winston from 'winston';

export interface QuizTokenReward {
  sessionId: string;
  userId: string;
  username: string;
  walletAddress: string;
  baseReward: number;
  bonusReward: number;
  totalReward: number;
  factors: {
    accuracy: number;
    difficulty: string;
    streak: number;
    timeBonus: number;
    perfectScore: boolean;
    personalBest: boolean;
  };
  timestamp: Date;
  status: 'pending' | 'processed' | 'completed' | 'failed';
  transactionHash?: string;
}

export interface TokenLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  totalEarned: number;
  totalQuizzes: number;
  averageReward: number;
  bestStreak: number;
  favoriteTopics: string[];
  lastActive: Date;
  achievements: string[];
}

export interface DailyTokenStats {
  date: Date;
  totalDistributed: number;
  uniqueEarners: number;
  totalQuizzes: number;
  averageReward: number;
  topEarner: {
    userId: string;
    username: string;
    amount: number;
  };
  popularTopics: Array<{
    topic: string;
    count: number;
    totalRewards: number;
  }>;
}

export interface UserTokenProfile {
  userId: string;
  username: string;
  walletAddress?: string;
  totalEarned: number;
  totalQuizzes: number;
  currentStreak: number;
  bestStreak: number;
  lastReward: Date;
  rewardHistory: QuizTokenReward[];
  achievements: Array<{
    type: string;
    name: string;
    description: string;
    earnedAt: Date;
    rewardAmount: number;
  }>;
  milestones: Array<{
    type: 'quiz_count' | 'streak' | 'earnings' | 'accuracy';
    threshold: number;
    achieved: boolean;
    progress: number;
    rewardAmount: number;
  }>;
}

export class QuizTokenIntegrationService {
  private tokenService: TokenService;
  private distributionService: RewardDistributionService;
  private solanaService: SolanaService;
  private config: BlockchainConfig;
  private logger: winston.Logger;
  
  // User wallet mappings
  private userWallets: Map<string, string> = new Map();
  
  // Token reward tracking
  private quizRewards: Map<string, QuizTokenReward> = new Map();
  private dailyStats: Map<string, DailyTokenStats> = new Map();
  private userProfiles: Map<string, UserTokenProfile> = new Map();
  
  // Achievement definitions
  private achievements = [
    {
      type: 'first_quiz',
      name: 'First Steps',
      description: 'Complete your first quiz',
      condition: (stats: UserQuizStats) => stats.sessionsPlayed >= 1,
      reward: 100
    },
    {
      type: 'perfect_score',
      name: 'Perfectionist',
      description: 'Achieve 100% accuracy in a quiz',
      condition: (session: QuizSession) => this.calculateAccuracy(session) === 100,
      reward: 200
    },
    {
      type: 'speed_demon',
      name: 'Speed Demon',
      description: 'Complete a quiz in under 2 minutes',
      condition: (session: QuizSession) => this.getSessionDuration(session) < 120,
      reward: 150
    },
    {
      type: 'streak_master',
      name: 'Streak Master',
      description: 'Maintain a 10-day streak',
      condition: (stats: UserQuizStats) => stats.currentStreak >= 10,
      reward: 500
    },
    {
      type: 'knowledge_seeker',
      name: 'Knowledge Seeker',
      description: 'Complete 50 quizzes',
      condition: (stats: UserQuizStats) => stats.sessionsPlayed >= 50,
      reward: 1000
    },
    {
      type: 'topic_explorer',
      name: 'Topic Explorer',
      description: 'Complete quizzes in 10 different topics',
      condition: (stats: UserQuizStats) => stats.favoriteTopics.length >= 10,
      reward: 300
    }
  ];

  constructor(
    tokenService: TokenService,
    distributionService: RewardDistributionService,
    solanaService: SolanaService,
    config: BlockchainConfig,
    logger: winston.Logger
  ) {
    this.tokenService = tokenService;
    this.distributionService = distributionService;
    this.solanaService = solanaService;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Initialize the quiz-token integration
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Quiz-Token Integration Service...');
    
    try {
      // Load existing user wallets and profiles
      await this.loadUserData();
      
      // Set up quiz completion listeners
      this.setupQuizListeners();
      
      this.logger.info('Quiz-Token Integration Service initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize quiz-token integration:', error);
      throw error;
    }
  }

  /**
   * Register user wallet for token rewards
   */
  async registerUserWallet(userId: string, walletAddress: string): Promise<boolean> {
    try {
      // Validate wallet address
      if (!this.solanaService.isValidWalletAddress(walletAddress)) {
        throw new Error('Invalid wallet address');
      }
      
      // Store wallet mapping
      this.userWallets.set(userId, walletAddress);
      
      // Initialize user profile if not exists
      if (!this.userProfiles.has(userId)) {
        const userStats = quizService.getUserStats(userId);
        if (userStats) {
          await this.createUserProfile(userStats, walletAddress);
        }
      }
      
      this.logger.info(`Wallet registered for user ${userId}: ${walletAddress}`);
      return true;
      
    } catch (error) {
      this.logger.error(`Failed to register wallet for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Process quiz completion and award tokens
   */
  async processQuizCompletion(sessionId: string): Promise<QuizTokenReward | null> {
    try {
      // This would typically be called by the quiz service
      // For now, we'll simulate getting session data
      const session = this.getSessionFromId(sessionId);
      if (!session) {
        this.logger.warn(`Quiz session not found: ${sessionId}`);
        return null;
      }
      
      const walletAddress = this.userWallets.get(session.userId);
      if (!walletAddress) {
        this.logger.warn(`No wallet registered for user ${session.userId}`);
        return null;
      }
      
      // Calculate reward factors
      const accuracy = this.calculateAccuracy(session);
      const timeBonus = this.calculateTimeBonus(session);
      const difficulty = this.getSessionDifficulty(session);
      const userStats = quizService.getUserStats(session.userId);
      const streak = userStats?.currentStreak || 0;
      
      // Check for special achievements
      const perfectScore = accuracy === 100;
      const personalBest = this.isPersonalBest(session);
      
      // Calculate rewards using token service
      const calculation = this.tokenService.calculateQuizReward(
        accuracy,
        difficulty,
        streak,
        timeBonus
      );
      
      let totalReward = calculation.finalAmount;
      
      // Add bonus rewards for achievements
      if (perfectScore) {
        totalReward += 50; // Perfect score bonus
      }
      
      if (personalBest) {
        totalReward += Math.floor(totalReward * 0.2); // 20% personal best bonus
      }
      
      // Create reward record
      const quizReward: QuizTokenReward = {
        sessionId,
        userId: session.userId,
        username: session.username,
        walletAddress,
        baseReward: calculation.baseReward,
        bonusReward: totalReward - calculation.baseReward,
        totalReward,
        factors: {
          accuracy,
          difficulty,
          streak,
          timeBonus,
          perfectScore,
          personalBest
        },
        timestamp: new Date(),
        status: 'pending'
      };
      
      // Store reward
      this.quizRewards.set(sessionId, quizReward);
      
      // Award through token service
      const tokenReward = await this.tokenService.awardQuizReward(
        session.userId,
        session.username || 'Unknown',
        walletAddress,
        sessionId,
        accuracy,
        difficulty,
        streak,
        timeBonus
      );
      
      if (tokenReward) {
        quizReward.status = 'processed';
        this.quizRewards.set(sessionId, quizReward);
        
        // Check and award achievements
        await this.checkAndAwardAchievements(session);
        
        // Update user profile
        await this.updateUserProfile(session.userId, quizReward);
        
        // Update daily statistics
        this.updateDailyStats(quizReward);
        
        this.logger.info(
          `Quiz reward processed for ${session.userId}: ${totalReward} MWOR (session: ${sessionId})`
        );
      }
      
      return quizReward;
      
    } catch (error) {
      this.logger.error(`Failed to process quiz completion ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Get user token balance and quiz earnings
   */
  async getUserTokenInfo(userId: string): Promise<{
    balance: number;
    totalEarned: number;
    pendingRewards: number;
    recentRewards: QuizTokenReward[];
    achievements: any[];
    nextMilestones: any[];
  } | null> {
    try {
      const walletAddress = this.userWallets.get(userId);
      if (!walletAddress) {
        return null;
      }
      
      // Get current balance
      const tokenBalance = await this.tokenService.getUserBalance(userId, walletAddress);
      
      // Get user profile
      const profile = this.userProfiles.get(userId);
      if (!profile) {
        return null;
      }
      
      // Get recent rewards
      const recentRewards = Array.from(this.quizRewards.values())
        .filter(reward => reward.userId === userId)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 10);
      
      // Calculate pending rewards
      const pendingRewards = recentRewards
        .filter(reward => reward.status === 'pending' || reward.status === 'processed')
        .reduce((sum, reward) => sum + reward.totalReward, 0);
      
      // Get next milestones
      const nextMilestones = profile.milestones
        .filter(milestone => !milestone.achieved)
        .sort((a, b) => (b.progress / b.threshold) - (a.progress / a.threshold))
        .slice(0, 3);
      
      return {
        balance: tokenBalance.balance,
        totalEarned: profile.totalEarned,
        pendingRewards,
        recentRewards,
        achievements: profile.achievements,
        nextMilestones
      };
      
    } catch (error) {
      this.logger.error(`Failed to get token info for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Generate token leaderboard for quiz participants
   */
  async generateTokenLeaderboard(
    period: 'daily' | 'weekly' | 'monthly' | 'all_time' = 'weekly',
    limit: number = 50
  ): Promise<TokenLeaderboardEntry[]> {
    try {
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
          startTime = new Date(0);
      }
      
      // Get relevant rewards in time period
      const relevantRewards = Array.from(this.quizRewards.values())
        .filter(reward => reward.timestamp >= startTime && reward.status === 'completed');
      
      // Aggregate by user
      const userEarnings = new Map<string, {
        username: string;
        totalEarned: number;
        totalQuizzes: number;
      }>();
      
      relevantRewards.forEach(reward => {
        const existing = userEarnings.get(reward.userId) || {
          username: reward.username,
          totalEarned: 0,
          totalQuizzes: 0
        };
        
        existing.totalEarned += reward.totalReward;
        existing.totalQuizzes += 1;
        userEarnings.set(reward.userId, existing);
      });
      
      // Convert to leaderboard entries
      const entries: TokenLeaderboardEntry[] = [];
      
      for (const [userId, earnings] of userEarnings.entries()) {
        const profile = this.userProfiles.get(userId);
        if (profile) {
          entries.push({
            rank: 0, // Will be set after sorting
            userId,
            username: earnings.username,
            totalEarned: earnings.totalEarned,
            totalQuizzes: earnings.totalQuizzes,
            averageReward: earnings.totalEarned / earnings.totalQuizzes,
            bestStreak: profile.bestStreak,
            favoriteTopics: profile.milestones
              .filter(m => m.type === 'quiz_count')
              .map(m => 'Various'), // Simplified
            lastActive: profile.lastReward,
            achievements: profile.achievements.map(a => a.name)
          });
        }
      }
      
      // Sort by total earned and assign ranks
      entries.sort((a, b) => b.totalEarned - a.totalEarned);
      entries.forEach((entry, index) => {
        entry.rank = index + 1;
      });
      
      return entries.slice(0, limit);
      
    } catch (error) {
      this.logger.error(`Failed to generate token leaderboard:`, error);
      return [];
    }
  }

  /**
   * Get daily token statistics
   */
  getDailyTokenStats(date?: Date): DailyTokenStats | null {
    const targetDate = date || new Date();
    const dateKey = targetDate.toISOString().split('T')[0];
    return this.dailyStats.get(dateKey) || null;
  }

  /**
   * Calculate accuracy for a quiz session
   */
  private calculateAccuracy(session: QuizSession): number {
    if (!session.answers || session.answers.length === 0) return 0;
    
    let correct = 0;
    for (const answer of session.answers) {
      if (answer.correct) {
        correct++;
      }
    }
    
    return Math.round((correct / session.answers.length) * 100);
  }

  /**
   * Calculate time bonus for quiz completion
   */
  private calculateTimeBonus(session: QuizSession): number {
    if (!session.endTime) return 0;
    
    const duration = this.getSessionDuration(session);
    const targetTime = session.answers.length * 60; // 1 minute per question
    
    if (duration < targetTime) {
      const timeRatio = duration / targetTime;
      return Math.max(0, (1 - timeRatio) * 0.25); // Up to 25% bonus
    }
    
    return 0;
  }

  /**
   * Get session duration in seconds
   */
  private getSessionDuration(session: QuizSession): number {
    if (!session.endTime) return 0;
    return Math.round((session.endTime.getTime() - session.startTime.getTime()) / 1000);
  }

  /**
   * Get session difficulty
   */
  private getSessionDifficulty(session: QuizSession): 'easy' | 'medium' | 'hard' {
    // This would be stored in the session or determined by topic/questions
    // For now, return medium as default
    return 'medium';
  }

  /**
   * Check if this is a personal best for the user
   */
  private isPersonalBest(session: QuizSession): boolean {
    const userStats = quizService.getUserStats(session.userId);
    if (!userStats) return true; // First quiz is always a personal best
    
    const currentAccuracy = this.calculateAccuracy(session);
    // Simplified check - in reality this would compare against topic-specific bests
    return currentAccuracy > userStats.averageScore;
  }

  /**
   * Check if answer is correct
   */
  private isCorrectAnswer(question: any, answer: string): boolean {
    // This would use the actual question evaluation logic
    // For now, return a placeholder
    return Math.random() > 0.3; // 70% success rate for simulation
  }

  /**
   * Get session from ID (placeholder)
   */
  private getSessionFromId(sessionId: string): QuizSession | null {
    // In reality, this would fetch from the quiz service
    // For now, return null as we don't have direct access
    return null;
  }

  /**
   * Set up quiz completion listeners
   */
  private setupQuizListeners(): void {
    // In a real implementation, this would set up event listeners
    // on the quiz service to automatically process rewards
    this.logger.debug('Quiz completion listeners set up');
  }

  /**
   * Load existing user data
   */
  private async loadUserData(): Promise<void> {
    // In production, this would load from database
    this.logger.debug('Loading user wallet mappings and profiles...');
  }

  /**
   * Create user profile
   */
  private async createUserProfile(userStats: UserQuizStats, walletAddress: string): Promise<void> {
    const profile: UserTokenProfile = {
      userId: userStats.userId,
      username: userStats.username,
      walletAddress,
      totalEarned: 0,
      totalQuizzes: userStats.sessionsPlayed,
      currentStreak: userStats.currentStreak,
      bestStreak: userStats.bestStreak,
      lastReward: new Date(),
      rewardHistory: [],
      achievements: [],
      milestones: [
        {
          type: 'quiz_count',
          threshold: 10,
          achieved: userStats.sessionsPlayed >= 10,
          progress: userStats.sessionsPlayed,
          rewardAmount: 200
        },
        {
          type: 'streak',
          threshold: 7,
          achieved: userStats.bestStreak >= 7,
          progress: userStats.currentStreak,
          rewardAmount: 300
        },
        {
          type: 'earnings',
          threshold: 1000,
          achieved: false,
          progress: 0,
          rewardAmount: 500
        },
        {
          type: 'accuracy',
          threshold: 90,
          achieved: userStats.averageScore >= 90,
          progress: userStats.averageScore,
          rewardAmount: 400
        }
      ]
    };
    
    this.userProfiles.set(userStats.userId, profile);
  }

  /**
   * Update user profile after quiz completion
   */
  private async updateUserProfile(userId: string, reward: QuizTokenReward): Promise<void> {
    const profile = this.userProfiles.get(userId);
    if (!profile) return;
    
    profile.totalEarned += reward.totalReward;
    profile.totalQuizzes += 1;
    profile.lastReward = reward.timestamp;
    profile.rewardHistory.unshift(reward);
    
    // Keep only last 50 rewards
    if (profile.rewardHistory.length > 50) {
      profile.rewardHistory = profile.rewardHistory.slice(0, 50);
    }
    
    // Update milestones
    profile.milestones.forEach(milestone => {
      switch (milestone.type) {
        case 'quiz_count':
          milestone.progress = profile.totalQuizzes;
          break;
        case 'earnings':
          milestone.progress = profile.totalEarned;
          break;
      }
      
      if (!milestone.achieved && milestone.progress >= milestone.threshold) {
        milestone.achieved = true;
        // Award milestone reward
        this.awardMilestoneReward(userId, milestone);
      }
    });
    
    this.userProfiles.set(userId, profile);
  }

  /**
   * Check and award achievements
   */
  private async checkAndAwardAchievements(session: QuizSession): Promise<void> {
    const userStats = quizService.getUserStats(session.userId);
    if (!userStats) return;
    
    const profile = this.userProfiles.get(session.userId);
    if (!profile) return;
    
    for (const achievement of this.achievements) {
      // Check if user already has this achievement
      const hasAchievement = profile.achievements.some(a => a.type === achievement.type);
      if (hasAchievement) continue;
      
      // Check achievement condition
      let earned = false;
      if (achievement.condition.length === 1) {
        // User stats based achievement
        earned = (achievement.condition as any)(userStats);
      } else {
        // Session based achievement
        earned = (achievement.condition as any)(session);
      }
      
      if (earned) {
        // Award achievement
        const achievementRecord = {
          type: achievement.type,
          name: achievement.name,
          description: achievement.description,
          earnedAt: new Date(),
          rewardAmount: achievement.reward
        };
        
        profile.achievements.push(achievementRecord);
        profile.totalEarned += achievement.reward;
        
        // Award tokens for achievement
        const walletAddress = this.userWallets.get(session.userId);
        if (walletAddress) {
          await this.tokenService.awardQuizReward(
            session.userId,
            session.username || 'Unknown',
            walletAddress,
            `achievement_${achievement.type}`,
            100, // Full score for achievement
            'medium',
            0,
            0
          );
        }
        
        this.logger.info(
          `Achievement earned by ${session.userId}: ${achievement.name} (+${achievement.reward} MWOR)`
        );
      }
    }
    
    this.userProfiles.set(session.userId, profile);
  }

  /**
   * Award milestone reward
   */
  private async awardMilestoneReward(userId: string, milestone: any): Promise<void> {
    const walletAddress = this.userWallets.get(userId);
    const profile = this.userProfiles.get(userId);
    
    if (walletAddress && profile) {
      await this.tokenService.awardQuizReward(
        userId,
        profile.username,
        walletAddress,
        `milestone_${milestone.type}`,
        100,
        'medium',
        0,
        0
      );
      
      this.logger.info(
        `Milestone reached by ${userId}: ${milestone.type} (+${milestone.rewardAmount} MWOR)`
      );
    }
  }

  /**
   * Update daily statistics
   */
  private updateDailyStats(reward: QuizTokenReward): void {
    const dateKey = reward.timestamp.toISOString().split('T')[0];
    let stats = this.dailyStats.get(dateKey);
    
    if (!stats) {
      stats = {
        date: new Date(dateKey),
        totalDistributed: 0,
        uniqueEarners: 0,
        totalQuizzes: 0,
        averageReward: 0,
        topEarner: {
          userId: reward.userId,
          username: reward.username,
          amount: 0
        },
        popularTopics: []
      };
    }
    
    stats.totalDistributed += reward.totalReward;
    stats.totalQuizzes += 1;
    stats.averageReward = stats.totalDistributed / stats.totalQuizzes;
    
    if (reward.totalReward > stats.topEarner.amount) {
      stats.topEarner = {
        userId: reward.userId,
        username: reward.username,
        amount: reward.totalReward
      };
    }
    
    this.dailyStats.set(dateKey, stats);
  }
}