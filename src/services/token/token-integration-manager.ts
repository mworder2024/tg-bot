import { TokenService } from './token.service.js';
import { RewardDistributionService } from './reward-distribution.service.js';
import { QuizTokenIntegrationService } from './quiz-token-integration.service.js';
import { SecurityComplianceService } from './security-compliance.service.js';
import { SolanaService } from '../../blockchain/solana-service.js';
import { PaymentService } from '../../blockchain/payment-service.js';
import { WalletManager } from '../../blockchain/wallet-manager.js';
import { BlockchainConfig } from '../../types/blockchain.js';
import config from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import winston from 'winston';

export interface TokenIntegrationConfig {
  enableTokenRewards: boolean;
  enableQuizIntegration: boolean;
  enableSecurityCompliance: boolean;
  enableDistributionAnalytics: boolean;
  rewardRates: {
    quizCompletion: {
      easy: number;
      medium: number;
      hard: number;
    };
    bonusMultipliers: {
      perfectScore: number;
      personalBest: number;
      streak: number;
    };
    achievements: {
      [key: string]: number;
    };
  };
  securitySettings: {
    maxDailyRewards: number;
    maxHourlyRewards: number;
    riskThreshold: number;
    enableAutoBlock: boolean;
  };
}

export interface IntegrationStatus {
  isInitialized: boolean;
  services: {
    tokenService: boolean;
    distributionService: boolean;
    quizIntegration: boolean;
    securityCompliance: boolean;
  };
  healthChecks: {
    solanaConnection: boolean;
    walletBalance: boolean;
    securityRules: boolean;
    lastHealthCheck: Date;
  };
  statistics: {
    totalUsersRegistered: number;
    totalTokensDistributed: number;
    totalTransactionsProcessed: number;
    averageRewardAmount: number;
    securityIncidents: number;
    complianceRate: number;
  };
}

export interface UserWalletRegistration {
  userId: string;
  username: string;
  walletAddress: string;
  verificationSignature?: string;
  registrationDate: Date;
  isVerified: boolean;
  verificationMethod: 'manual' | 'signature' | 'transaction';
}

export interface TokenOperationResult {
  success: boolean;
  transactionHash?: string;
  amount?: number;
  error?: string;
  riskScore?: number;
  complianceViolations?: string[];
}

export class TokenIntegrationManager {
  private tokenService: TokenService;
  private distributionService: RewardDistributionService;
  private quizIntegrationService: QuizTokenIntegrationService;
  private securityComplianceService: SecurityComplianceService;
  private solanaService: SolanaService;
  private paymentService: PaymentService;
  private walletManager: WalletManager;
  
  private config: TokenIntegrationConfig;
  private blockchainConfig: BlockchainConfig;
  private logger: winston.Logger;
  
  // Service state
  private isInitialized = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private registeredWallets: Map<string, UserWalletRegistration> = new Map();
  
  // Performance metrics
  private performanceMetrics = {
    totalOperations: 0,
    successfulOperations: 0,
    averageOperationTime: 0,
    lastOperationTime: new Date(),
    errorRate: 0
  };

  constructor() {
    this.logger = logger;
    
    // Initialize blockchain configuration
    this.blockchainConfig = {
      rpcUrl: config.solana.rpcUrl,
      network: config.solana.network as 'mainnet-beta' | 'devnet' | 'testnet',
      mworTokenMint: config.solana.tokenMint,
      botWalletPrivateKey: config.solana.botWalletKey,
      treasuryWalletPrivateKey: config.solana.botWalletKey, // Same for now
      paymentTimeoutMinutes: 30,
      minConfirmationCount: 1,
      systemFeePercentage: 10,
      encryptionKey: 'encryption-key-placeholder'
    };
    
    // Initialize token integration configuration
    this.config = {
      enableTokenRewards: config.features.blockchain,
      enableQuizIntegration: config.features.quizMode,
      enableSecurityCompliance: true,
      enableDistributionAnalytics: true,
      rewardRates: {
        quizCompletion: {
          easy: 50,
          medium: 100,
          hard: 200
        },
        bonusMultipliers: {
          perfectScore: 1.5,
          personalBest: 1.2,
          streak: 0.05 // 5% per streak day
        },
        achievements: {
          first_quiz: 100,
          perfect_score: 200,
          speed_demon: 150,
          streak_master: 500,
          knowledge_seeker: 1000,
          topic_explorer: 300
        }
      },
      securitySettings: {
        maxDailyRewards: 100,
        maxHourlyRewards: 20,
        riskThreshold: 0.7,
        enableAutoBlock: true
      }
    };
    
    this.initializeServices();
  }

  /**
   * Initialize all token integration services
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Token Integration Manager...');
    
    try {
      if (!this.config.enableTokenRewards) {
        this.logger.info('Token rewards disabled in configuration');
        return;
      }
      
      // Initialize services in order
      await this.tokenService.initialize();
      this.logger.info('Token service initialized');
      
      await this.distributionService.initialize();
      this.logger.info('Distribution service initialized');
      
      if (this.config.enableQuizIntegration) {
        await this.quizIntegrationService.initialize();
        this.logger.info('Quiz integration service initialized');
      }
      
      if (this.config.enableSecurityCompliance) {
        await this.securityComplianceService.initialize();
        this.logger.info('Security compliance service initialized');
      }
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      this.isInitialized = true;
      this.logger.info('Token Integration Manager initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize Token Integration Manager:', error);
      throw error;
    }
  }

  /**
   * Shutdown all services
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Token Integration Manager...');
    
    try {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      // Shutdown services
      this.tokenService.shutdown();
      this.distributionService.shutdown();
      
      if (this.config.enableSecurityCompliance) {
        this.securityComplianceService.shutdown();
      }
      
      this.isInitialized = false;
      this.logger.info('Token Integration Manager shutdown complete');
      
    } catch (error) {
      this.logger.error('Error during Token Integration Manager shutdown:', error);
    }
  }

  /**
   * Register user wallet for token rewards
   */
  async registerUserWallet(
    userId: string,
    username: string,
    walletAddress: string,
    verificationSignature?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isInitialized) {
        return { success: false, error: 'Token integration not initialized' };
      }
      
      // Validate wallet address
      if (!this.solanaService.isValidWalletAddress(walletAddress)) {
        return { success: false, error: 'Invalid wallet address format' };
      }
      
      // Check if wallet is already registered
      const existingRegistration = Array.from(this.registeredWallets.values())
        .find(reg => reg.walletAddress === walletAddress);
      
      if (existingRegistration && existingRegistration.userId !== userId) {
        return { success: false, error: 'Wallet address already registered to another user' };
      }
      
      // Security compliance check
      if (this.config.enableSecurityCompliance) {
        const validation = await this.securityComplianceService.validateTransaction(
          userId,
          0, // No amount for registration
          'wallet_registration',
          { walletAddress, verificationSignature }
        );
        
        if (!validation.approved) {
          return { 
            success: false, 
            error: `Registration blocked: ${validation.violations.join(', ')}` 
          };
        }
      }
      
      // Create registration record
      const registration: UserWalletRegistration = {
        userId,
        username,
        walletAddress,
        verificationSignature,
        registrationDate: new Date(),
        isVerified: !!verificationSignature,
        verificationMethod: verificationSignature ? 'signature' : 'manual'
      };
      
      // Register with quiz integration service
      if (this.config.enableQuizIntegration) {
        const quizRegistration = await this.quizIntegrationService.registerUserWallet(
          userId,
          walletAddress
        );
        
        if (!quizRegistration) {
          return { success: false, error: 'Failed to register with quiz integration' };
        }
      }
      
      // Store registration
      this.registeredWallets.set(userId, registration);
      
      this.logger.info(`Wallet registered for user ${userId}: ${walletAddress}`);
      return { success: true };
      
    } catch (error) {
      this.logger.error(`Failed to register wallet for user ${userId}:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Process quiz completion and distribute rewards
   */
  async processQuizCompletion(
    sessionId: string,
    userId: string,
    quizData: {
      accuracy: number;
      difficulty: 'easy' | 'medium' | 'hard';
      completionTime: number;
      streak: number;
      isPersonalBest: boolean;
      isPerfectScore: boolean;
    }
  ): Promise<TokenOperationResult> {
    const startTime = Date.now();
    
    try {
      if (!this.isInitialized || !this.config.enableQuizIntegration) {
        return { success: false, error: 'Quiz integration not available' };
      }
      
      // Check if user has registered wallet
      const registration = this.registeredWallets.get(userId);
      if (!registration) {
        return { success: false, error: 'User wallet not registered' };
      }
      
      // Security compliance check
      if (this.config.enableSecurityCompliance) {
        const baseReward = this.config.rewardRates.quizCompletion[quizData.difficulty];
        const validation = await this.securityComplianceService.validateTransaction(
          userId,
          baseReward,
          'quiz_reward',
          { sessionId, quizData }
        );
        
        if (!validation.approved) {
          return {
            success: false,
            error: `Reward blocked: ${validation.violations.join(', ')}`,
            riskScore: validation.riskScore,
            complianceViolations: validation.violations
          };
        }
      }
      
      // Process reward through quiz integration service
      const reward = await this.quizIntegrationService.processQuizCompletion(sessionId);
      
      if (!reward) {
        return { success: false, error: 'Failed to process quiz reward' };
      }
      
      // Update performance metrics
      this.updatePerformanceMetrics(Date.now() - startTime, true);
      
      this.logger.info(
        `Quiz reward processed for user ${userId}: ${reward.totalReward} MWOR (session: ${sessionId})`
      );
      
      return {
        success: true,
        transactionHash: reward.transactionHash,
        amount: reward.totalReward
      };
      
    } catch (error) {
      this.updatePerformanceMetrics(Date.now() - startTime, false);
      this.logger.error(`Failed to process quiz completion for user ${userId}:`, error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get user token information
   */
  async getUserTokenInfo(userId: string): Promise<{
    isRegistered: boolean;
    walletAddress?: string;
    balance?: number;
    totalEarned?: number;
    pendingRewards?: number;
    recentRewards?: any[];
    achievements?: any[];
    nextMilestones?: any[];
    riskProfile?: any;
  }> {
    try {
      const registration = this.registeredWallets.get(userId);
      if (!registration) {
        return { isRegistered: false };
      }
      
      // Get token info from quiz integration service
      let tokenInfo = null;
      if (this.config.enableQuizIntegration) {
        tokenInfo = await this.quizIntegrationService.getUserTokenInfo(userId);
      }
      
      // Get risk profile if security compliance is enabled
      let riskProfile = null;
      if (this.config.enableSecurityCompliance) {
        riskProfile = await this.securityComplianceService.getUserRiskProfile(userId);
      }
      
      return {
        isRegistered: true,
        walletAddress: registration.walletAddress,
        balance: tokenInfo?.balance || 0,
        totalEarned: tokenInfo?.totalEarned || 0,
        pendingRewards: tokenInfo?.pendingRewards || 0,
        recentRewards: tokenInfo?.recentRewards || [],
        achievements: tokenInfo?.achievements || [],
        nextMilestones: tokenInfo?.nextMilestones || [],
        riskProfile: riskProfile ? {
          riskLevel: riskProfile.riskLevel,
          riskScore: riskProfile.riskScore,
          restrictions: riskProfile.restrictions.filter(r => r.active)
        } : null
      };
      
    } catch (error) {
      this.logger.error(`Failed to get token info for user ${userId}:`, error);
      return { isRegistered: false };
    }
  }

  /**
   * Generate token leaderboard
   */
  async generateTokenLeaderboard(
    period: 'daily' | 'weekly' | 'monthly' | 'all_time' = 'weekly',
    limit: number = 50
  ): Promise<any[]> {
    try {
      if (!this.config.enableQuizIntegration) {
        return [];
      }
      
      return await this.quizIntegrationService.generateTokenLeaderboard(period, limit);
      
    } catch (error) {
      this.logger.error('Failed to generate token leaderboard:', error);
      return [];
    }
  }

  /**
   * Get integration status and health
   */
  async getIntegrationStatus(): Promise<IntegrationStatus> {
    try {
      // Perform health checks
      const healthChecks = await this.performHealthChecks();
      
      // Get service statistics
      const tokenStats = this.tokenService.getServiceStats();
      const securityMetrics = this.config.enableSecurityCompliance ? 
        this.securityComplianceService.getSecurityMetrics() : null;
      
      const totalUsersRegistered = this.registeredWallets.size;
      
      return {
        isInitialized: this.isInitialized,
        services: {
          tokenService: true,
          distributionService: true,
          quizIntegration: this.config.enableQuizIntegration,
          securityCompliance: this.config.enableSecurityCompliance
        },
        healthChecks,
        statistics: {
          totalUsersRegistered,
          totalTokensDistributed: tokenStats.totalTokensDistributed,
          totalTransactionsProcessed: tokenStats.totalRewards,
          averageRewardAmount: tokenStats.totalTokensDistributed / Math.max(tokenStats.completedRewards, 1),
          securityIncidents: securityMetrics?.activeIncidents || 0,
          complianceRate: securityMetrics ? 
            (1 - securityMetrics.blockedTransactions / Math.max(securityMetrics.totalTransactionsProcessed, 1)) : 1
        }
      };
      
    } catch (error) {
      this.logger.error('Failed to get integration status:', error);
      
      return {
        isInitialized: false,
        services: {
          tokenService: false,
          distributionService: false,
          quizIntegration: false,
          securityCompliance: false
        },
        healthChecks: {
          solanaConnection: false,
          walletBalance: false,
          securityRules: false,
          lastHealthCheck: new Date()
        },
        statistics: {
          totalUsersRegistered: 0,
          totalTokensDistributed: 0,
          totalTransactionsProcessed: 0,
          averageRewardAmount: 0,
          securityIncidents: 0,
          complianceRate: 0
        }
      };
    }
  }

  /**
   * Get compliance report
   */
  async getComplianceReport(
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    if (!this.config.enableSecurityCompliance) {
      return null;
    }
    
    try {
      return await this.securityComplianceService.generateComplianceReport(startDate, endDate);
    } catch (error) {
      this.logger.error('Failed to generate compliance report:', error);
      return null;
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): typeof this.performanceMetrics & {
    registeredUsers: number;
    uptime: number;
  } {
    const uptime = this.isInitialized ? Date.now() - this.performanceMetrics.lastOperationTime.getTime() : 0;
    
    return {
      ...this.performanceMetrics,
      registeredUsers: this.registeredWallets.size,
      uptime
    };
  }

  /**
   * Initialize all services
   */
  private initializeServices(): void {
    // Initialize Solana service
    this.solanaService = new SolanaService(this.blockchainConfig, this.logger);
    
    // Initialize wallet manager (simplified)
    this.walletManager = new (class {
      async createPaymentRequest() { return null; }
      async verifyPayment() { return { received: false }; }
      async processRefunds() { return []; }
    })() as any;
    
    // Initialize payment service
    this.paymentService = new PaymentService(
      this.walletManager,
      this.blockchainConfig,
      this.logger
    );
    
    // Initialize token service
    this.tokenService = new TokenService(
      this.solanaService,
      this.blockchainConfig,
      this.logger
    );
    
    // Initialize distribution service
    this.distributionService = new RewardDistributionService(
      this.tokenService,
      this.solanaService,
      this.blockchainConfig,
      this.logger
    );
    
    // Initialize quiz integration service
    this.quizIntegrationService = new QuizTokenIntegrationService(
      this.tokenService,
      this.distributionService,
      this.solanaService,
      this.blockchainConfig,
      this.logger
    );
    
    // Initialize security compliance service
    this.securityComplianceService = new SecurityComplianceService(
      this.tokenService,
      this.solanaService,
      this.blockchainConfig,
      this.logger
    );
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthChecks();
      } catch (error) {
        this.logger.error('Health check failed:', error);
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Perform health checks
   */
  private async performHealthChecks(): Promise<IntegrationStatus['healthChecks']> {
    try {
      // Check Solana connection
      const solanaConnection = await this.solanaService.isConnected();
      
      // Check wallet balance (simplified)
      let walletBalance = false;
      try {
        const balance = await this.solanaService.getWalletBalance(
          'bot-wallet-address-placeholder'
        );
        walletBalance = balance.solBalance > 0;
      } catch {
        walletBalance = false;
      }
      
      // Check security rules
      const securityRules = this.config.enableSecurityCompliance;
      
      return {
        solanaConnection,
        walletBalance,
        securityRules,
        lastHealthCheck: new Date()
      };
      
    } catch (error) {
      this.logger.error('Health check error:', error);
      return {
        solanaConnection: false,
        walletBalance: false,
        securityRules: false,
        lastHealthCheck: new Date()
      };
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(operationTime: number, success: boolean): void {
    this.performanceMetrics.totalOperations++;
    
    if (success) {
      this.performanceMetrics.successfulOperations++;
    }
    
    this.performanceMetrics.averageOperationTime = 
      (this.performanceMetrics.averageOperationTime + operationTime) / 2;
    
    this.performanceMetrics.lastOperationTime = new Date();
    
    this.performanceMetrics.errorRate = 
      1 - (this.performanceMetrics.successfulOperations / this.performanceMetrics.totalOperations);
  }
}

// Export singleton instance
export const tokenIntegrationManager = new TokenIntegrationManager();