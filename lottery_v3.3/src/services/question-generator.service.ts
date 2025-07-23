import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { anthropicService, QuestionGenerationRequest, GeneratedQuestion } from './anthropic.service.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

// Enhanced interfaces for question generation
export interface QuestionTemplate {
  id: string;
  topic: string;
  subtopic?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  template: string;
  variables: string[];
  category: string;
  estimatedTokenCost: number;
  createdAt: Date;
  lastUsed?: Date;
  usageCount: number;
}

export interface QuestionGeneratorConfig {
  batchSize: number;
  minimumPoolSize: number;
  maxPoolSize: number;
  refreshIntervalMinutes: number;
  qualityThreshold: number;
  topicDistribution: Record<string, number>;
  difficultyDistribution: Record<string, number>;
}

export interface QuestionPool {
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  questions: GeneratedQuestion[];
  lastRefreshed: Date;
  isStale: boolean;
  targetSize: number;
  currentSize: number;
}

export interface QuestionQualityMetrics {
  readabilityScore: number;
  difficultyConsistency: number;
  answerDistribution: number;
  topicRelevance: number;
  uniquenessScore: number;
  overallQuality: number;
}

export interface ApiRateLimit {
  userId?: string;
  endpoint: string;
  requestsThisMinute: number;
  requestsThisHour: number;
  requestsToday: number;
  resetTimeMinute: Date;
  resetTimeHour: Date;
  resetTimeDay: Date;
  isLimited: boolean;
  backoffUntil?: Date;
}

export interface GenerationQueue {
  id: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  request: QuestionGenerationRequest;
  userId?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  scheduledFor: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';
  error?: string;
  result?: GeneratedQuestion[];
}

export interface QuestionAnalytics {
  topic: string;
  difficulty: string;
  totalGenerated: number;
  successRate: number;
  averageQuality: number;
  averageResponseTime: number;
  topFailureReasons: string[];
  usageFrequency: number;
  lastGenerated: Date;
}

export class QuestionGeneratorService {
  private readonly QUESTION_POOL_PREFIX = 'question_pool:';
  private readonly RATE_LIMIT_PREFIX = 'rate_limit:';
  private readonly QUEUE_KEY = 'question_generation_queue';
  private readonly ANALYTICS_KEY = 'question_analytics';
  
  private config: QuestionGeneratorConfig;
  private questionPools: Map<string, QuestionPool> = new Map();
  private generationQueue: GenerationQueue[] = [];
  private isProcessingQueue = false;
  private rateLimits: Map<string, ApiRateLimit> = new Map();
  
  constructor(
    private readonly db: Pool,
    private readonly redis: Redis
  ) {
    this.config = {
      batchSize: 10,
      minimumPoolSize: 50,
      maxPoolSize: 200,
      refreshIntervalMinutes: 30,
      qualityThreshold: 0.8,
      topicDistribution: {
        'General Knowledge': 0.25,
        'Science & Technology': 0.20,
        'History': 0.15,
        'Sports': 0.10,
        'Entertainment': 0.10,
        'Geography': 0.10,
        'Mathematics': 0.10,
      },
      difficultyDistribution: {
        'easy': 0.4,
        'medium': 0.4,
        'hard': 0.2,
      },
    };

    this.initialize();
  }

  /**
   * Initialize the question generator service
   */
  private async initialize(): Promise<void> {
    try {
      await this.createDatabaseTables();
      await this.loadQuestionPools();
      await this.startBackgroundGeneration();
      await this.startQueueProcessor();
      
      logger.info('Question Generator Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Question Generator Service:', error);
      throw error;
    }
  }

  /**
   * Create necessary database tables
   */
  private async createDatabaseTables(): Promise<void> {
    const tables = [
      `
      CREATE TABLE IF NOT EXISTS question_pools (
        id VARCHAR(36) PRIMARY KEY,
        topic VARCHAR(255) NOT NULL,
        difficulty VARCHAR(10) NOT NULL,
        questions JSONB NOT NULL DEFAULT '[]',
        last_refreshed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        target_size INTEGER DEFAULT 50,
        current_size INTEGER DEFAULT 0,
        is_stale BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(topic, difficulty)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS question_templates (
        id VARCHAR(36) PRIMARY KEY,
        topic VARCHAR(255) NOT NULL,
        subtopic VARCHAR(255),
        difficulty VARCHAR(10) NOT NULL,
        template TEXT NOT NULL,
        variables JSONB NOT NULL DEFAULT '[]',
        category VARCHAR(255) NOT NULL,
        estimated_token_cost INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP,
        usage_count INTEGER DEFAULT 0
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS generation_queue (
        id VARCHAR(36) PRIMARY KEY,
        priority VARCHAR(10) DEFAULT 'medium',
        request JSONB NOT NULL,
        user_id VARCHAR(255),
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        scheduled_for TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        error TEXT,
        result JSONB
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS question_analytics (
        id VARCHAR(36) PRIMARY KEY,
        topic VARCHAR(255) NOT NULL,
        difficulty VARCHAR(10) NOT NULL,
        total_generated INTEGER DEFAULT 0,
        success_rate DECIMAL(5,4) DEFAULT 0,
        average_quality DECIMAL(5,4) DEFAULT 0,
        average_response_time INTEGER DEFAULT 0,
        top_failure_reasons JSONB DEFAULT '[]',
        usage_frequency INTEGER DEFAULT 0,
        last_generated TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(topic, difficulty)
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_question_pools_topic_difficulty 
        ON question_pools(topic, difficulty)
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_generation_queue_status_priority 
        ON generation_queue(status, priority, scheduled_for)
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_question_analytics_topic 
        ON question_analytics(topic, difficulty)
      `,
    ];

    for (const tableQuery of tables) {
      await this.db.query(tableQuery);
    }
  }

  /**
   * Start background question generation process
   */
  private async startBackgroundGeneration(): Promise<void> {
    // Initial population of question pools
    await this.populateQuestionPools();

    // Set up periodic refresh
    setInterval(async () => {
      await this.refreshStaleQuestionPools();
    }, this.config.refreshIntervalMinutes * 60 * 1000);

    // Monitor pool levels every 5 minutes
    setInterval(async () => {
      await this.monitorPoolLevels();
    }, 5 * 60 * 1000);

    logger.info('Background question generation started');
  }

  /**
   * Start queue processor for handling generation requests
   */
  private async startQueueProcessor(): Promise<void> {
    setInterval(async () => {
      if (!this.isProcessingQueue) {
        await this.processGenerationQueue();
      }
    }, 10000); // Process queue every 10 seconds

    logger.info('Question generation queue processor started');
  }

  /**
   * Populate initial question pools for all topics and difficulties
   */
  private async populateQuestionPools(): Promise<void> {
    const topics = Object.keys(this.config.topicDistribution);
    const difficulties: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard'];

    for (const topic of topics) {
      for (const difficulty of difficulties) {
        const poolKey = `${topic}:${difficulty}`;
        
        // Check if pool exists in database
        const existingPool = await this.getPoolFromDatabase(topic, difficulty);
        
        if (!existingPool || existingPool.currentSize < this.config.minimumPoolSize) {
          // Queue generation request
          await this.queueGenerationRequest({
            topic,
            difficulty,
            count: this.config.minimumPoolSize,
            questionType: 'multiple_choice',
          }, 'medium', 'system');
        } else {
          // Load existing pool
          this.questionPools.set(poolKey, existingPool);
        }
      }
    }

    logger.info(`Initialized question pools for ${topics.length * difficulties.length} topic-difficulty combinations`);
  }

  /**
   * Monitor pool levels and queue replenishment requests
   */
  private async monitorPoolLevels(): Promise<void> {
    for (const [poolKey, pool] of this.questionPools) {
      if (pool.currentSize < this.config.minimumPoolSize) {
        const needed = this.config.minimumPoolSize - pool.currentSize;
        
        logger.info(`Pool ${poolKey} below threshold (${pool.currentSize}/${this.config.minimumPoolSize}). Queuing ${needed} questions.`);
        
        await this.queueGenerationRequest({
          topic: pool.topic,
          difficulty: pool.difficulty,
          count: Math.min(needed, this.config.batchSize),
          questionType: 'multiple_choice',
        }, 'high', 'system');
      }
    }
  }

  /**
   * Refresh stale question pools
   */
  private async refreshStaleQuestionPools(): Promise<void> {
    const staleThreshold = new Date(Date.now() - this.config.refreshIntervalMinutes * 60 * 1000);
    
    for (const [poolKey, pool] of this.questionPools) {
      if (pool.lastRefreshed < staleThreshold) {
        pool.isStale = true;
        
        // Queue refresh request
        await this.queueGenerationRequest({
          topic: pool.topic,
          difficulty: pool.difficulty,
          count: Math.min(this.config.batchSize, this.config.maxPoolSize - pool.currentSize),
          questionType: 'multiple_choice',
        }, 'low', 'system');
      }
    }
  }

  /**
   * Queue a question generation request
   */
  async queueGenerationRequest(
    request: QuestionGenerationRequest,
    priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium',
    userId?: string
  ): Promise<string> {
    const queueItem: GenerationQueue = {
      id: uuidv4(),
      priority,
      request,
      userId,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      scheduledFor: new Date(),
      status: 'pending',
    };

    // Check rate limits for user requests
    if (userId && userId !== 'system') {
      const rateLimitKey = `user:${userId}`;
      if (await this.isRateLimited(rateLimitKey)) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
    }

    // Store in database
    await this.db.query(`
      INSERT INTO generation_queue 
      (id, priority, request, user_id, retry_count, max_retries, created_at, scheduled_for, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      queueItem.id,
      queueItem.priority,
      JSON.stringify(queueItem.request),
      queueItem.userId,
      queueItem.retryCount,
      queueItem.maxRetries,
      queueItem.createdAt,
      queueItem.scheduledFor,
      queueItem.status,
    ]);

    // Cache in Redis for quick access
    await this.redis.zadd(this.QUEUE_KEY, this.getPriorityScore(priority), queueItem.id);

    logger.info(`Queued generation request: ${queueItem.id} (Priority: ${priority})`);
    return queueItem.id;
  }

  /**
   * Process the generation queue
   */
  private async processGenerationQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    
    this.isProcessingQueue = true;
    
    try {
      // Get highest priority items
      const queueItems = await this.redis.zrevrange(this.QUEUE_KEY, 0, 4); // Process up to 5 items
      
      for (const itemId of queueItems) {
        await this.processQueueItem(itemId);
      }
    } catch (error) {
      logger.error('Error processing generation queue:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Process a single queue item
   */
  private async processQueueItem(itemId: string): Promise<void> {
    try {
      // Get item from database
      const result = await this.db.query(
        'SELECT * FROM generation_queue WHERE id = $1 AND status = $2',
        [itemId, 'pending']
      );

      if (result.rows.length === 0) {
        // Item not found or already processed
        await this.redis.zrem(this.QUEUE_KEY, itemId);
        return;
      }

      const item: GenerationQueue = {
        id: result.rows[0].id,
        priority: result.rows[0].priority,
        request: result.rows[0].request,
        userId: result.rows[0].user_id,
        retryCount: result.rows[0].retry_count,
        maxRetries: result.rows[0].max_retries,
        createdAt: result.rows[0].created_at,
        scheduledFor: result.rows[0].scheduled_for,
        status: result.rows[0].status,
        error: result.rows[0].error,
        result: result.rows[0].result,
      };

      // Check if item is scheduled for future
      if (item.scheduledFor > new Date()) {
        return;
      }

      // Update status to processing
      await this.updateQueueItemStatus(itemId, 'processing');

      // Check rate limits
      const rateLimitKey = `generation:global`;
      if (await this.isRateLimited(rateLimitKey)) {
        // Reschedule for later
        const backoffTime = await this.calculateBackoffTime(item.retryCount);
        await this.rescheduleQueueItem(itemId, backoffTime);
        return;
      }

      // Generate questions
      const startTime = Date.now();
      const questions = await anthropicService.generateQuestions(
        item.request,
        item.userId || 'system'
      );

      const responseTime = Date.now() - startTime;

      // Validate question quality
      const validQuestions = await this.validateQuestionQuality(questions);
      
      if (validQuestions.length === 0) {
        throw new Error('No valid questions generated');
      }

      // Store questions in pool
      await this.addQuestionsToPool(
        item.request.topic,
        item.request.difficulty,
        validQuestions
      );

      // Update analytics
      await this.updateAnalytics(
        item.request.topic,
        item.request.difficulty,
        validQuestions.length,
        responseTime,
        true
      );

      // Mark as completed
      await this.updateQueueItemStatus(itemId, 'completed', validQuestions);
      await this.redis.zrem(this.QUEUE_KEY, itemId);

      logger.info(`Successfully processed queue item ${itemId}: ${validQuestions.length} questions generated`);

    } catch (error) {
      logger.error(`Error processing queue item ${itemId}:`, error);
      await this.handleQueueItemError(itemId, error as Error);
    }
  }

  /**
   * Validate question quality using multiple metrics
   */
  private async validateQuestionQuality(questions: GeneratedQuestion[]): Promise<GeneratedQuestion[]> {
    const validQuestions: GeneratedQuestion[] = [];

    for (const question of questions) {
      const quality = await this.calculateQuestionQuality(question);
      
      if (quality.overallQuality >= this.config.qualityThreshold) {
        validQuestions.push({
          ...question,
          // Add quality score to question metadata
          explanation: `${question.explanation || ''}\n[Quality Score: ${quality.overallQuality.toFixed(2)}]`,
        });
      } else {
        logger.warn(`Question rejected due to low quality (${quality.overallQuality.toFixed(2)}): ${question.question.substring(0, 50)}...`);
      }
    }

    return validQuestions;
  }

  /**
   * Calculate question quality metrics
   */
  private async calculateQuestionQuality(question: GeneratedQuestion): Promise<QuestionQualityMetrics> {
    // Readability score (simple heuristic)
    const readabilityScore = this.calculateReadabilityScore(question.question);
    
    // Difficulty consistency (check if question matches stated difficulty)
    const difficultyConsistency = this.assessDifficultyConsistency(question);
    
    // Answer distribution (for multiple choice)
    const answerDistribution = this.checkAnswerDistribution(question);
    
    // Topic relevance (simple keyword matching)
    const topicRelevance = this.assessTopicRelevance(question);
    
    // Uniqueness score (check against existing questions)
    const uniquenessScore = await this.calculateUniquenessScore(question);
    
    // Overall quality (weighted average)
    const overallQuality = (
      readabilityScore * 0.2 +
      difficultyConsistency * 0.2 +
      answerDistribution * 0.2 +
      topicRelevance * 0.2 +
      uniquenessScore * 0.2
    );

    return {
      readabilityScore,
      difficultyConsistency,
      answerDistribution,
      topicRelevance,
      uniquenessScore,
      overallQuality,
    };
  }

  /**
   * Calculate readability score based on question complexity
   */
  private calculateReadabilityScore(questionText: string): number {
    const words = questionText.split(/\s+/).length;
    const sentences = questionText.split(/[.!?]+/).length;
    const avgWordsPerSentence = words / Math.max(sentences, 1);
    
    // Prefer questions with 10-25 words and clear structure
    if (words < 5) return 0.3; // Too short
    if (words > 40) return 0.5; // Too long
    if (avgWordsPerSentence > 20) return 0.6; // Too complex
    
    return Math.min(1.0, 0.7 + (15 - Math.abs(15 - words)) / 30);
  }

  /**
   * Assess if question difficulty matches stated level
   */
  private assessDifficultyConsistency(question: GeneratedQuestion): number {
    const questionText = question.question.toLowerCase();
    
    // Difficulty indicators
    const easyIndicators = ['what is', 'which of', 'how many', 'true or false'];
    const hardIndicators = ['analyze', 'evaluate', 'compare', 'synthesize', 'complex'];
    
    const hasEasyIndicators = easyIndicators.some(indicator => questionText.includes(indicator));
    const hasHardIndicators = hardIndicators.some(indicator => questionText.includes(indicator));
    
    switch (question.difficulty) {
      case 'easy':
        return hasEasyIndicators ? 1.0 : (hasHardIndicators ? 0.3 : 0.7);
      case 'hard':
        return hasHardIndicators ? 1.0 : (hasEasyIndicators ? 0.3 : 0.7);
      case 'medium':
        return (!hasEasyIndicators && !hasHardIndicators) ? 1.0 : 0.8;
      default:
        return 0.5;
    }
  }

  /**
   * Check answer distribution for multiple choice questions
   */
  private checkAnswerDistribution(question: GeneratedQuestion): number {
    if (question.type !== 'multiple_choice' || !question.options) {
      return 1.0; // Not applicable
    }

    const options = question.options;
    const correctIndex = parseInt(question.correctAnswer.match(/^([a-d])/i)?.[1] || '0', 36) - 10;
    
    // Check if all options have similar length (good practice)
    const lengths = options.map(opt => opt.length);
    const avgLength = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
    const lengthVariance = lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / lengths.length;
    
    // Lower variance is better
    const lengthScore = Math.max(0, 1 - lengthVariance / 1000);
    
    // Check if correct answer is distributed (not always A or B)
    const positionScore = correctIndex >= 0 && correctIndex < options.length ? 1.0 : 0.0;
    
    return (lengthScore + positionScore) / 2;
  }

  /**
   * Assess topic relevance using keyword matching
   */
  private assessTopicRelevance(question: GeneratedQuestion): number {
    const questionText = question.question.toLowerCase();
    const topic = question.topic.toLowerCase();
    
    // Simple keyword matching
    const topicKeywords = topic.split(/\s+/);
    const matchCount = topicKeywords.filter(keyword => 
      questionText.includes(keyword) || 
      (question.explanation && question.explanation.toLowerCase().includes(keyword))
    ).length;
    
    return Math.min(1.0, matchCount / Math.max(topicKeywords.length, 1));
  }

  /**
   * Calculate uniqueness score by checking against existing questions
   */
  private async calculateUniquenessScore(question: GeneratedQuestion): Promise<number> {
    try {
      // Check against recent questions in the same topic
      const existingQuestions = await this.redis.lrange(
        `${this.QUESTION_POOL_PREFIX}${question.topic}:${question.difficulty}:recent`,
        0, 100
      );

      if (existingQuestions.length === 0) {
        return 1.0;
      }

      // Simple similarity check using shared words
      const questionWords = new Set(question.question.toLowerCase().split(/\s+/));
      let maxSimilarity = 0;

      for (const existingQuestionJson of existingQuestions) {
        try {
          const existingQuestion = JSON.parse(existingQuestionJson);
          const existingWords = new Set(existingQuestion.question.toLowerCase().split(/\s+/));
          
          const intersection = new Set([...questionWords].filter(word => existingWords.has(word)));
          const union = new Set([...questionWords, ...existingWords]);
          const similarity = intersection.size / union.size;
          
          maxSimilarity = Math.max(maxSimilarity, similarity);
        } catch {
          // Skip malformed questions
        }
      }

      // Return inverse of similarity (higher uniqueness = lower similarity)
      return Math.max(0, 1 - maxSimilarity);
    } catch (error) {
      logger.warn('Error calculating uniqueness score:', error);
      return 0.8; // Default to reasonable score
    }
  }

  /**
   * Add questions to the appropriate pool
   */
  private async addQuestionsToPool(
    topic: string,
    difficulty: 'easy' | 'medium' | 'hard',
    questions: GeneratedQuestion[]
  ): Promise<void> {
    const poolKey = `${topic}:${difficulty}`;
    
    // Update in-memory pool
    let pool = this.questionPools.get(poolKey);
    if (!pool) {
      pool = {
        topic,
        difficulty,
        questions: [],
        lastRefreshed: new Date(),
        isStale: false,
        targetSize: this.config.minimumPoolSize,
        currentSize: 0,
      };
      this.questionPools.set(poolKey, pool);
    }

    // Add questions (avoiding duplicates)
    const existingIds = new Set(pool.questions.map(q => q.id));
    const newQuestions = questions.filter(q => !existingIds.has(q.id));
    
    pool.questions.push(...newQuestions);
    pool.currentSize = pool.questions.length;
    pool.lastRefreshed = new Date();
    pool.isStale = false;

    // Trim pool if it exceeds max size
    if (pool.questions.length > this.config.maxPoolSize) {
      pool.questions = pool.questions.slice(-this.config.maxPoolSize);
      pool.currentSize = pool.questions.length;
    }

    // Update database
    await this.savePoolToDatabase(pool);

    // Cache recent questions for uniqueness checking
    const recentKey = `${this.QUESTION_POOL_PREFIX}${topic}:${difficulty}:recent`;
    for (const question of newQuestions) {
      await this.redis.lpush(recentKey, JSON.stringify(question));
    }
    await this.redis.ltrim(recentKey, 0, 199); // Keep last 200 questions
    await this.redis.expire(recentKey, 24 * 60 * 60); // 24 hour TTL

    logger.info(`Added ${newQuestions.length} questions to pool ${poolKey} (Total: ${pool.currentSize})`);
  }

  /**
   * Get questions from pool for immediate use
   */
  async getQuestionsFromPool(
    topic: string,
    difficulty: 'easy' | 'medium' | 'hard',
    count: number,
    userId?: string
  ): Promise<GeneratedQuestion[]> {
    const poolKey = `${topic}:${difficulty}`;
    let pool = this.questionPools.get(poolKey);

    if (!pool || pool.questions.length === 0) {
      // Pool doesn't exist or is empty, queue urgent generation
      await this.queueGenerationRequest({
        topic,
        difficulty,
        count: Math.max(count, this.config.minimumPoolSize),
        questionType: 'multiple_choice',
      }, 'urgent', userId);

      // Return empty array for now - user will need to retry
      return [];
    }

    // Select questions from pool
    const availableQuestions = [...pool.questions];
    const selectedQuestions: GeneratedQuestion[] = [];

    for (let i = 0; i < Math.min(count, availableQuestions.length); i++) {
      // Remove from available to avoid duplicates
      const randomIndex = Math.floor(Math.random() * availableQuestions.length);
      const question = availableQuestions.splice(randomIndex, 1)[0];
      selectedQuestions.push(question);
    }

    // Update usage analytics
    await this.updateUsageAnalytics(topic, difficulty, selectedQuestions.length);

    // Check if pool needs replenishment
    pool.currentSize -= selectedQuestions.length;
    if (pool.currentSize < this.config.minimumPoolSize) {
      await this.queueGenerationRequest({
        topic,
        difficulty,
        count: this.config.batchSize,
        questionType: 'multiple_choice',
      }, 'high', 'system');
    }

    return selectedQuestions;
  }

  /**
   * Check if a request/user is rate limited
   */
  private async isRateLimited(key: string): Promise<boolean> {
    const limitInfo = await this.getRateLimitInfo(key);
    
    const now = new Date();
    
    // Check if in backoff period
    if (limitInfo.backoffUntil && now < limitInfo.backoffUntil) {
      return true;
    }

    // Reset counters if time windows have passed
    if (now > limitInfo.resetTimeMinute) {
      limitInfo.requestsThisMinute = 0;
      limitInfo.resetTimeMinute = new Date(now.getTime() + 60000);
    }

    if (now > limitInfo.resetTimeHour) {
      limitInfo.requestsThisHour = 0;
      limitInfo.resetTimeHour = new Date(now.getTime() + 3600000);
    }

    if (now > limitInfo.resetTimeDay) {
      limitInfo.requestsToday = 0;
      limitInfo.resetTimeDay = new Date(now.getTime() + 24 * 3600000);
    }

    // Check limits based on key type
    const limits = this.getRateLimitsForKey(key);
    
    const isLimited = (
      limitInfo.requestsThisMinute >= limits.perMinute ||
      limitInfo.requestsThisHour >= limits.perHour ||
      limitInfo.requestsToday >= limits.perDay
    );

    if (!isLimited) {
      // Increment counters
      limitInfo.requestsThisMinute++;
      limitInfo.requestsThisHour++;
      limitInfo.requestsToday++;
    }

    limitInfo.isLimited = isLimited;
    
    // Cache the updated limit info
    await this.cacheRateLimitInfo(key, limitInfo);
    
    return isLimited;
  }

  /**
   * Get rate limit configuration for different key types
   */
  private getRateLimitsForKey(key: string): { perMinute: number; perHour: number; perDay: number } {
    if (key.startsWith('user:')) {
      return {
        perMinute: 5,
        perHour: 50,
        perDay: 200,
      };
    } else if (key.startsWith('generation:')) {
      return {
        perMinute: config.anthropic.rateLimitPerMinute,
        perHour: config.anthropic.rateLimitPerHour,
        perDay: config.anthropic.rateLimitPerHour * 24,
      };
    } else {
      return {
        perMinute: 10,
        perHour: 100,
        perDay: 500,
      };
    }
  }

  /**
   * Get rate limit info for a key
   */
  private async getRateLimitInfo(key: string): Promise<ApiRateLimit> {
    // Try to get from cache first
    const cached = await this.redis.get(`${this.RATE_LIMIT_PREFIX}${key}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      return {
        ...parsed,
        resetTimeMinute: new Date(parsed.resetTimeMinute),
        resetTimeHour: new Date(parsed.resetTimeHour),
        resetTimeDay: new Date(parsed.resetTimeDay),
        backoffUntil: parsed.backoffUntil ? new Date(parsed.backoffUntil) : undefined,
      };
    }

    // Create new limit info
    const now = new Date();
    return {
      endpoint: key,
      requestsThisMinute: 0,
      requestsThisHour: 0,
      requestsToday: 0,
      resetTimeMinute: new Date(now.getTime() + 60000),
      resetTimeHour: new Date(now.getTime() + 3600000),
      resetTimeDay: new Date(now.getTime() + 24 * 3600000),
      isLimited: false,
    };
  }

  /**
   * Cache rate limit info
   */
  private async cacheRateLimitInfo(key: string, limitInfo: ApiRateLimit): Promise<void> {
    const cacheKey = `${this.RATE_LIMIT_PREFIX}${key}`;
    await this.redis.setex(cacheKey, 86400, JSON.stringify(limitInfo)); // 24 hour TTL
  }

  /**
   * Calculate backoff time based on retry count
   */
  private async calculateBackoffTime(retryCount: number): Promise<Date> {
    // Exponential backoff: 2^retryCount minutes
    const backoffMinutes = Math.pow(2, retryCount);
    return new Date(Date.now() + backoffMinutes * 60 * 1000);
  }

  /**
   * Get priority score for queue ordering
   */
  private getPriorityScore(priority: string): number {
    const scores = {
      urgent: 1000,
      high: 100,
      medium: 10,
      low: 1,
    };
    return scores[priority as keyof typeof scores] || 10;
  }

  /**
   * Update queue item status
   */
  private async updateQueueItemStatus(
    itemId: string,
    status: GenerationQueue['status'],
    result?: GeneratedQuestion[],
    error?: string
  ): Promise<void> {
    await this.db.query(`
      UPDATE generation_queue 
      SET status = $1, result = $2, error = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [status, result ? JSON.stringify(result) : null, error, itemId]);
  }

  /**
   * Reschedule queue item for later processing
   */
  private async rescheduleQueueItem(itemId: string, scheduledFor: Date): Promise<void> {
    await this.db.query(`
      UPDATE generation_queue 
      SET scheduled_for = $1, retry_count = retry_count + 1
      WHERE id = $2
    `, [scheduledFor, itemId]);

    // Update Redis queue with new timestamp
    await this.redis.zadd(this.QUEUE_KEY, scheduledFor.getTime(), itemId);
  }

  /**
   * Handle queue item errors with retry logic
   */
  private async handleQueueItemError(itemId: string, error: Error): Promise<void> {
    const result = await this.db.query(
      'SELECT retry_count, max_retries FROM generation_queue WHERE id = $1',
      [itemId]
    );

    if (result.rows.length === 0) return;

    const { retry_count, max_retries } = result.rows[0];

    if (retry_count < max_retries) {
      // Retry with backoff
      const backoffTime = await this.calculateBackoffTime(retry_count);
      await this.rescheduleQueueItem(itemId, backoffTime);
      await this.updateQueueItemStatus(itemId, 'retrying', undefined, error.message);
      
      logger.warn(`Retrying queue item ${itemId} after error: ${error.message}`);
    } else {
      // Max retries exceeded
      await this.updateQueueItemStatus(itemId, 'failed', undefined, error.message);
      await this.redis.zrem(this.QUEUE_KEY, itemId);
      
      logger.error(`Queue item ${itemId} failed after ${max_retries} retries: ${error.message}`);
    }
  }

  /**
   * Load question pools from database
   */
  private async loadQuestionPools(): Promise<void> {
    const result = await this.db.query('SELECT * FROM question_pools');
    
    for (const row of result.rows) {
      const poolKey = `${row.topic}:${row.difficulty}`;
      const pool: QuestionPool = {
        topic: row.topic,
        difficulty: row.difficulty,
        questions: row.questions || [],
        lastRefreshed: row.last_refreshed,
        isStale: row.is_stale,
        targetSize: row.target_size,
        currentSize: row.current_size,
      };
      
      this.questionPools.set(poolKey, pool);
    }

    logger.info(`Loaded ${result.rows.length} question pools from database`);
  }

  /**
   * Get pool from database
   */
  private async getPoolFromDatabase(topic: string, difficulty: string): Promise<QuestionPool | null> {
    const result = await this.db.query(
      'SELECT * FROM question_pools WHERE topic = $1 AND difficulty = $2',
      [topic, difficulty]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      topic: row.topic,
      difficulty: row.difficulty,
      questions: row.questions || [],
      lastRefreshed: row.last_refreshed,
      isStale: row.is_stale,
      targetSize: row.target_size,
      currentSize: row.current_size,
    };
  }

  /**
   * Save pool to database
   */
  private async savePoolToDatabase(pool: QuestionPool): Promise<void> {
    await this.db.query(`
      INSERT INTO question_pools 
      (id, topic, difficulty, questions, last_refreshed, target_size, current_size, is_stale, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (topic, difficulty) 
      DO UPDATE SET 
        questions = $4,
        last_refreshed = $5,
        target_size = $6,
        current_size = $7,
        is_stale = $8,
        updated_at = CURRENT_TIMESTAMP
    `, [
      uuidv4(),
      pool.topic,
      pool.difficulty,
      JSON.stringify(pool.questions),
      pool.lastRefreshed,
      pool.targetSize,
      pool.currentSize,
      pool.isStale,
    ]);
  }

  /**
   * Update analytics
   */
  private async updateAnalytics(
    topic: string,
    difficulty: string,
    count: number,
    responseTime: number,
    success: boolean
  ): Promise<void> {
    await this.db.query(`
      INSERT INTO question_analytics 
      (id, topic, difficulty, total_generated, success_rate, average_response_time, last_generated, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (topic, difficulty) 
      DO UPDATE SET 
        total_generated = question_analytics.total_generated + $4,
        success_rate = (question_analytics.success_rate * question_analytics.total_generated + $5) / (question_analytics.total_generated + $4),
        average_response_time = (question_analytics.average_response_time * question_analytics.total_generated + $6) / (question_analytics.total_generated + $4),
        last_generated = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `, [
      uuidv4(),
      topic,
      difficulty,
      count,
      success ? 1 : 0,
      responseTime,
    ]);
  }

  /**
   * Update usage analytics
   */
  private async updateUsageAnalytics(topic: string, difficulty: string, count: number): Promise<void> {
    await this.db.query(`
      UPDATE question_analytics 
      SET usage_frequency = usage_frequency + $3, updated_at = CURRENT_TIMESTAMP
      WHERE topic = $1 AND difficulty = $2
    `, [topic, difficulty, count]);
  }

  /**
   * Get generator status and metrics
   */
  async getGeneratorStatus(): Promise<{
    poolStatus: Array<{
      topic: string;
      difficulty: string;
      currentSize: number;
      targetSize: number;
      isStale: boolean;
      lastRefreshed: Date;
    }>;
    queueStatus: {
      pending: number;
      processing: number;
      completed: number;
      failed: number;
    };
    analytics: QuestionAnalytics[];
  }> {
    // Pool status
    const poolStatus = Array.from(this.questionPools.values()).map(pool => ({
      topic: pool.topic,
      difficulty: pool.difficulty,
      currentSize: pool.currentSize,
      targetSize: pool.targetSize,
      isStale: pool.isStale,
      lastRefreshed: pool.lastRefreshed,
    }));

    // Queue status
    const queueResult = await this.db.query(`
      SELECT status, COUNT(*) as count 
      FROM generation_queue 
      GROUP BY status
    `);
    
    const queueStatus = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };
    
    for (const row of queueResult.rows) {
      queueStatus[row.status as keyof typeof queueStatus] = parseInt(row.count);
    }

    // Analytics
    const analyticsResult = await this.db.query('SELECT * FROM question_analytics ORDER BY last_generated DESC');
    const analytics = analyticsResult.rows.map(row => ({
      topic: row.topic,
      difficulty: row.difficulty,
      totalGenerated: row.total_generated,
      successRate: parseFloat(row.success_rate),
      averageQuality: parseFloat(row.average_quality),
      averageResponseTime: row.average_response_time,
      topFailureReasons: row.top_failure_reasons || [],
      usageFrequency: row.usage_frequency,
      lastGenerated: row.last_generated,
    }));

    return {
      poolStatus,
      queueStatus,
      analytics,
    };
  }

  /**
   * Health check for the generator service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    pools: number;
    queueLength: number;
    rateLimitStatus: string;
    lastError?: string;
  }> {
    try {
      const poolCount = this.questionPools.size;
      const queueLength = await this.redis.zcard(this.QUEUE_KEY);
      
      // Check if any pools are critically low
      const criticallyLowPools = Array.from(this.questionPools.values())
        .filter(pool => pool.currentSize < this.config.minimumPoolSize * 0.2).length;
      
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (criticallyLowPools > 0) {
        status = 'degraded';
      }
      
      if (poolCount === 0 || queueLength > 100) {
        status = 'unhealthy';
      }

      return {
        status,
        pools: poolCount,
        queueLength,
        rateLimitStatus: 'normal',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        pools: 0,
        queueLength: 0,
        rateLimitStatus: 'error',
        lastError: (error as Error).message,
      };
    }
  }
}

export const questionGeneratorService = new QuestionGeneratorService(
  // These will be injected when the service is instantiated
  {} as Pool,
  {} as Redis
);