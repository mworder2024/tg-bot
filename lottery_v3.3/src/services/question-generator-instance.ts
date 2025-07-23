import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { QuestionGeneratorService } from './question-generator.service.js';
import { QuestionGeneratorMonitorService } from './question-generator-monitor.service.js';
import { questionIntegrationService } from './question-integration.service.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Question Generator Bot Instance
 * 
 * This is the main entry point for the question generator instance.
 * It coordinates all the question generation services and provides
 * a unified interface for the quiz bot to request questions.
 */
export class QuestionGeneratorInstance {
  private db: Pool;
  private redis: Redis;
  private generatorService: QuestionGeneratorService;
  private monitorService: QuestionGeneratorMonitorService;
  private isInitialized = false;

  constructor() {
    // Initialize database connection
    this.db = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Initialize Redis connection  
    this.redis = new Redis(config.redis.url, {
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    // Initialize services with dependencies
    this.generatorService = new QuestionGeneratorService(this.db, this.redis);
    this.monitorService = new QuestionGeneratorMonitorService(this.db, this.redis);
  }

  /**
   * Initialize the question generator instance
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Question generator instance already initialized');
      return;
    }

    try {
      logger.info('Initializing Question Generator Bot Instance...');

      // Test database connection
      await this.db.query('SELECT NOW()');
      logger.info('Database connection established');

      // Test Redis connection
      await this.redis.ping();
      logger.info('Redis connection established');

      // Set up event listeners between services
      this.setupEventListeners();

      // Pre-warm question pools based on common topics
      await this.prewarmCommonTopics();

      this.isInitialized = true;
      logger.info('Question Generator Bot Instance initialized successfully');

      // Emit initialization event
      questionIntegrationService.emit('instanceReady', {
        timestamp: new Date(),
        services: ['generator', 'monitor', 'integration']
      });

    } catch (error) {
      logger.error('Failed to initialize Question Generator Instance:', error);
      throw error;
    }
  }

  /**
   * Set up event listeners between services
   */
  private setupEventListeners(): void {
    // Monitor service alerts
    this.monitorService.on('alert', (alert) => {
      logger.warn(`Generator Alert [${alert.severity.toUpperCase()}]: ${alert.message}`);
      
      // Forward critical alerts to integration service
      if (alert.severity === 'critical') {
        questionIntegrationService.emit('criticalAlert', alert);
      }
    });

    // Monitor metrics updates
    this.monitorService.on('metrics', (metrics) => {
      // Could emit metrics to external monitoring systems
      if (metrics.errorRate > 0.1) {
        logger.warn(`High error rate detected: ${(metrics.errorRate * 100).toFixed(1)}%`);
      }
    });

    // Integration service events
    questionIntegrationService.on('questionsDelivered', (event) => {
      logger.info(`Questions delivered: ${event.requestId} (${event.deliveryTime}ms, source: ${event.source})`);
    });

    questionIntegrationService.on('requestFailed', (event) => {
      logger.error(`Question request failed: ${event.requestId} - ${event.error}`);
    });

    // Database connection events
    this.db.on('error', (error) => {
      logger.error('Database connection error:', error);
      this.monitorService.emit('serviceError', { service: 'database', error });
    });

    // Redis connection events
    this.redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
      this.monitorService.emit('serviceError', { service: 'redis', error });
    });

    this.redis.on('connect', () => {
      logger.info('Redis connected');
    });

    this.redis.on('reconnecting', () => {
      logger.warn('Redis reconnecting...');
    });
  }

  /**
   * Pre-warm common question topics and difficulties
   */
  private async prewarmCommonTopics(): Promise<void> {
    const commonPatterns = [
      { topic: 'General Knowledge', difficulty: 'easy' as const, expectedUsage: 100 },
      { topic: 'General Knowledge', difficulty: 'medium' as const, expectedUsage: 80 },
      { topic: 'General Knowledge', difficulty: 'hard' as const, expectedUsage: 40 },
      { topic: 'Science & Technology', difficulty: 'easy' as const, expectedUsage: 60 },
      { topic: 'Science & Technology', difficulty: 'medium' as const, expectedUsage: 50 },
      { topic: 'History', difficulty: 'easy' as const, expectedUsage: 40 },
      { topic: 'History', difficulty: 'medium' as const, expectedUsage: 30 },
      { topic: 'Sports', difficulty: 'easy' as const, expectedUsage: 30 },
      { topic: 'Entertainment', difficulty: 'easy' as const, expectedUsage: 25 },
      { topic: 'Geography', difficulty: 'easy' as const, expectedUsage: 25 },
    ];

    await questionIntegrationService.prewarmPools(commonPatterns);
    logger.info('Common question topics pre-warmed');
  }

  /**
   * Get questions for immediate use (main API for quiz bot)
   */
  async getQuestions(
    userId: string,
    topic: string,
    difficulty: 'easy' | 'medium' | 'hard',
    count: number,
    options: {
      chatId?: string;
      questionType?: 'multiple_choice' | 'true_false' | 'open_ended';
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      context?: string;
      timeout?: number;
      fallbackEnabled?: boolean;
    } = {}
  ) {
    if (!this.isInitialized) {
      throw new Error('Question generator instance not initialized');
    }

    return await questionIntegrationService.requestQuestions(
      userId,
      topic,
      difficulty,
      count,
      options
    );
  }

  /**
   * Get questions for quiz game (optimized for quiz service)
   */
  async getQuizQuestions(
    gameId: string,
    category: string,
    difficulty: 'easy' | 'medium' | 'hard',
    count: number = 1
  ) {
    const result = await this.getQuestions(
      `quiz-game-${gameId}`,
      category,
      difficulty,
      count,
      {
        questionType: 'multiple_choice',
        priority: 'high',
        timeout: 15000, // 15 seconds for quiz games
        fallbackEnabled: true,
      }
    );

    if (result.status === 'immediate' && result.questions) {
      return result.questions;
    }

    // For quiz games, we need immediate response
    // If questions aren't available immediately, use fallback
    if (result.status === 'queued' && result.questions && result.questions.length > 0) {
      return result.questions;
    }

    // Last resort: use anthropic service directly (slower but guaranteed)
    logger.warn(`Using fallback generation for quiz game ${gameId}`);
    
    const fallbackQuestions = await this.generatorService['anthropicService'].generateQuestions({
      topic: category,
      difficulty,
      count,
      questionType: 'multiple_choice'
    }, `quiz-game-${gameId}`);

    return fallbackQuestions;
  }

  /**
   * Request bulk questions for pre-caching
   */
  async bulkRequestQuestions(
    userId: string,
    requests: Array<{
      topic: string;
      difficulty: 'easy' | 'medium' | 'hard';
      count: number;
      questionType?: 'multiple_choice' | 'true_false' | 'open_ended';
    }>,
    options: {
      chatId?: string;
      timeout?: number;
    } = {}
  ) {
    if (!this.isInitialized) {
      throw new Error('Question generator instance not initialized');
    }

    return await questionIntegrationService.bulkRequestQuestions(
      userId,
      requests,
      options
    );
  }

  /**
   * Get generator status and health
   */
  async getStatus() {
    if (!this.isInitialized) {
      return {
        status: 'not_initialized',
        services: {
          generator: 'not_initialized',
          monitor: 'not_initialized',
          integration: 'not_initialized'
        }
      };
    }

    const [generatorStatus, generatorHealth, integrationHealth, realtimeStats] = await Promise.all([
      this.generatorService.getGeneratorStatus(),
      this.generatorService.healthCheck(),
      questionIntegrationService.healthCheck(),
      this.monitorService.getRealtimeStats()
    ]);

    return {
      status: 'initialized',
      services: {
        generator: generatorHealth,
        integration: integrationHealth,
        monitor: {
          status: 'healthy',
          realtimeStats
        }
      },
      pools: generatorStatus.poolStatus,
      queue: generatorStatus.queueStatus,
      analytics: generatorStatus.analytics
    };
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts() {
    if (!this.isInitialized) {
      return [];
    }

    return await this.monitorService.getActiveAlerts();
  }

  /**
   * Get integration statistics
   */
  getIntegrationStats() {
    return questionIntegrationService.getStats();
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy?: string) {
    if (!this.isInitialized) {
      throw new Error('Question generator instance not initialized');
    }

    return await this.monitorService.acknowledgeAlert(alertId, acknowledgedBy);
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, resolvedBy?: string) {
    if (!this.isInitialized) {
      throw new Error('Question generator instance not initialized');
    }

    return await this.monitorService.resolveAlert(alertId, resolvedBy);
  }

  /**
   * Manually refresh a question pool
   */
  async refreshQuestionPool(
    topic: string,
    difficulty: 'easy' | 'medium' | 'hard',
    count: number = 10
  ) {
    if (!this.isInitialized) {
      throw new Error('Question generator instance not initialized');
    }

    return await this.generatorService.queueGenerationRequest({
      topic,
      difficulty,
      count,
      questionType: 'multiple_choice'
    }, 'high', 'admin-refresh');
  }

  /**
   * Get metrics history
   */
  async getMetricsHistory(hours: number = 24) {
    if (!this.isInitialized) {
      return [];
    }

    return await this.monitorService.getMetricsHistory(hours);
  }

  /**
   * Shutdown the generator instance gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    logger.info('Shutting down Question Generator Instance...');

    try {
      // Stop monitoring
      this.monitorService.stopMonitoring();

      // Close Redis connection
      await this.redis.quit();

      // Close database connection
      await this.db.end();

      this.isInitialized = false;
      logger.info('Question Generator Instance shut down successfully');

    } catch (error) {
      logger.error('Error during shutdown:', error);
      throw error;
    }
  }

  /**
   * Check if instance is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Export singleton instance
export const questionGeneratorInstance = new QuestionGeneratorInstance();

// Export types for external use
export type {
  QuestionRequest,
  DeliveryMode,
  IntegrationStats
} from './question-integration.service.js';

export type {
  GeneratorAlert,
  PerformanceMetrics,
  RealtimeStats
} from './question-generator-monitor.service.js';

export type {
  QuestionTemplate,
  QuestionGeneratorConfig,
  QuestionPool,
  QuestionQualityMetrics,
  ApiRateLimit,
  GenerationQueue,
  QuestionAnalytics
} from './question-generator.service.js';