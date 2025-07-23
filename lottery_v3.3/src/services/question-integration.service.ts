import { EventEmitter } from 'events';
import { questionGeneratorService } from './question-generator.service.js';
import { quizService } from './quiz.service.js';
import { anthropicService, GeneratedQuestion } from './anthropic.service.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

export interface QuestionRequest {
  id: string;
  userId: string;
  chatId?: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
  questionType: 'multiple_choice' | 'true_false' | 'open_ended';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  context?: string;
  timeout: number; // milliseconds
  createdAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';
  result?: GeneratedQuestion[];
  error?: string;
}

export interface DeliveryMode {
  type: 'immediate' | 'batch' | 'streaming';
  batchSize?: number;
  deliveryInterval?: number;
  fallbackEnabled?: boolean;
}

export interface IntegrationStats {
  totalRequests: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  averageDeliveryTime: number;
  cacheHitRate: number;
  fallbackUsage: number;
}

export class QuestionIntegrationService extends EventEmitter {
  private activeRequests: Map<string, QuestionRequest> = new Map();
  private deliveryQueue: QuestionRequest[] = [];
  private isProcessingDelivery = false;
  private stats: IntegrationStats = {
    totalRequests: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    averageDeliveryTime: 0,
    cacheHitRate: 0,
    fallbackUsage: 0,
  };

  constructor() {
    super();
    this.initialize();
  }

  /**
   * Initialize the integration service
   */
  private async initialize(): Promise<void> {
    // Start delivery processor
    setInterval(() => {
      if (!this.isProcessingDelivery) {
        this.processDeliveryQueue();
      }
    }, 1000);

    // Timeout handler for pending requests
    setInterval(() => {
      this.checkRequestTimeouts();
    }, 5000);

    logger.info('Question Integration Service initialized');
  }

  /**
   * Request questions for immediate use
   */
  async requestQuestions(
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
      deliveryMode?: DeliveryMode;
      fallbackEnabled?: boolean;
    } = {}
  ): Promise<{
    requestId: string;
    questions?: GeneratedQuestion[];
    status: 'immediate' | 'queued' | 'generating';
    estimatedDeliveryTime?: number;
  }> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const request: QuestionRequest = {
      id: requestId,
      userId,
      chatId: options.chatId,
      topic,
      difficulty,
      count,
      questionType: options.questionType || 'multiple_choice',
      priority: options.priority || 'medium',
      context: options.context,
      timeout: options.timeout || 30000, // 30 seconds default
      createdAt: new Date(),
      status: 'pending',
    };

    this.activeRequests.set(requestId, request);
    this.stats.totalRequests++;

    try {
      // Try to get questions from pool immediately
      const poolQuestions = await questionGeneratorService.getQuestionsFromPool(
        topic,
        difficulty,
        count,
        userId
      );

      if (poolQuestions.length >= count) {
        // Immediate delivery
        request.status = 'completed';
        request.result = poolQuestions.slice(0, count);
        
        this.stats.successfulDeliveries++;
        this.stats.cacheHitRate = this.calculateCacheHitRate();
        
        this.emit('questionsDelivered', {
          requestId,
          questions: request.result,
          deliveryTime: Date.now() - request.createdAt.getTime(),
          source: 'pool'
        });

        logger.info(`Questions delivered immediately from pool: ${requestId}`);
        return {
          requestId,
          questions: request.result,
          status: 'immediate'
        };
      }

      // Partial or no pool availability
      if (poolQuestions.length > 0 && options.fallbackEnabled !== false) {
        // Return what we have and queue the rest
        const remaining = count - poolQuestions.length;
        
        // Queue generation for remaining questions
        await this.queueQuestionGeneration(request, remaining);
        
        request.status = 'processing';
        request.result = poolQuestions;

        this.emit('partialDelivery', {
          requestId,
          questions: poolQuestions,
          remaining,
          status: 'generating'
        });

        logger.info(`Partial delivery from pool: ${requestId} (${poolQuestions.length}/${count})`);
        return {
          requestId,
          questions: poolQuestions,
          status: 'queued',
          estimatedDeliveryTime: this.estimateDeliveryTime(remaining)
        };
      }

      // No pool questions available, queue full generation
      await this.queueQuestionGeneration(request, count);
      request.status = 'processing';

      logger.info(`Questions queued for generation: ${requestId}`);
      return {
        requestId,
        status: 'generating',
        estimatedDeliveryTime: this.estimateDeliveryTime(count)
      };

    } catch (error) {
      request.status = 'failed';
      request.error = (error as Error).message;
      
      this.stats.failedDeliveries++;
      
      this.emit('requestFailed', {
        requestId,
        error: request.error,
        request
      });

      logger.error(`Question request failed: ${requestId}`, error);
      throw error;
    }
  }

  /**
   * Get status of a question request
   */
  async getRequestStatus(requestId: string): Promise<QuestionRequest | null> {
    return this.activeRequests.get(requestId) || null;
  }

  /**
   * Cancel a pending request
   */
  async cancelRequest(requestId: string): Promise<boolean> {
    const request = this.activeRequests.get(requestId);
    if (!request || request.status === 'completed') {
      return false;
    }

    request.status = 'failed';
    request.error = 'Cancelled by user';
    
    this.activeRequests.delete(requestId);
    
    this.emit('requestCancelled', { requestId, request });
    return true;
  }

  /**
   * Queue question generation
   */
  private async queueQuestionGeneration(
    request: QuestionRequest,
    count: number
  ): Promise<void> {
    try {
      const generationRequestId = await questionGeneratorService.queueGenerationRequest({
        topic: request.topic,
        difficulty: request.difficulty,
        count,
        questionType: request.questionType,
        context: request.context
      }, request.priority, request.userId);

      // Monitor the generation request
      this.monitorGenerationRequest(request.id, generationRequestId);
      
    } catch (error) {
      throw new Error(`Failed to queue generation: ${(error as Error).message}`);
    }
  }

  /**
   * Monitor a generation request and deliver when ready
   */
  private async monitorGenerationRequest(
    requestId: string,
    generationRequestId: string
  ): Promise<void> {
    const checkInterval = setInterval(async () => {
      try {
        const request = this.activeRequests.get(requestId);
        if (!request || request.status === 'failed') {
          clearInterval(checkInterval);
          return;
        }

        // Check generation status
        const result = await questionGeneratorService['db'].query(
          'SELECT * FROM generation_queue WHERE id = $1',
          [generationRequestId]
        );

        if (result.rows.length === 0) {
          clearInterval(checkInterval);
          this.handleRequestFailure(requestId, 'Generation request not found');
          return;
        }

        const generationRequest = result.rows[0];
        
        if (generationRequest.status === 'completed' && generationRequest.result) {
          clearInterval(checkInterval);
          
          const questions = generationRequest.result;
          const existingQuestions = request.result || [];
          const allQuestions = [...existingQuestions, ...questions];
          
          request.status = 'completed';
          request.result = allQuestions.slice(0, request.count);
          
          this.stats.successfulDeliveries++;
          this.updateAverageDeliveryTime(Date.now() - request.createdAt.getTime());
          
          this.emit('questionsDelivered', {
            requestId,
            questions: request.result,
            deliveryTime: Date.now() - request.createdAt.getTime(),
            source: 'generated'
          });

          logger.info(`Generated questions delivered: ${requestId}`);
          
        } else if (generationRequest.status === 'failed') {
          clearInterval(checkInterval);
          this.handleRequestFailure(requestId, generationRequest.error || 'Generation failed');
        }
        
      } catch (error) {
        logger.error(`Error monitoring generation request ${generationRequestId}:`, error);
      }
    }, 2000); // Check every 2 seconds

    // Set timeout for monitoring
    setTimeout(() => {
      clearInterval(checkInterval);
      const request = this.activeRequests.get(requestId);
      if (request && request.status === 'processing') {
        this.handleRequestFailure(requestId, 'Generation timeout');
      }
    }, 120000); // 2 minute timeout
  }

  /**
   * Handle request failure
   */
  private handleRequestFailure(requestId: string, error: string): void {
    const request = this.activeRequests.get(requestId);
    if (!request) return;

    request.status = 'failed';
    request.error = error;
    
    this.stats.failedDeliveries++;
    
    this.emit('requestFailed', {
      requestId,
      error,
      request
    });

    logger.error(`Request failed: ${requestId} - ${error}`);
  }

  /**
   * Process delivery queue for batched delivery
   */
  private async processDeliveryQueue(): Promise<void> {
    if (this.deliveryQueue.length === 0 || this.isProcessingDelivery) {
      return;
    }

    this.isProcessingDelivery = true;

    try {
      const request = this.deliveryQueue.shift();
      if (!request) return;

      // Process the delivery request
      await this.handleDeliveryRequest(request);
      
    } catch (error) {
      logger.error('Error processing delivery queue:', error);
    } finally {
      this.isProcessingDelivery = false;
    }
  }

  /**
   * Handle delivery request
   */
  private async handleDeliveryRequest(request: QuestionRequest): Promise<void> {
    // This method would integrate with the actual delivery mechanism
    // For now, it's a placeholder for the integration logic
    logger.info(`Processing delivery for request: ${request.id}`);
  }

  /**
   * Check for request timeouts
   */
  private checkRequestTimeouts(): void {
    const now = Date.now();
    
    for (const [requestId, request] of this.activeRequests) {
      if (request.status === 'processing' && 
          now - request.createdAt.getTime() > request.timeout) {
        
        request.status = 'timeout';
        request.error = 'Request timeout';
        
        this.emit('requestTimeout', {
          requestId,
          request
        });

        logger.warn(`Request timeout: ${requestId}`);
      }
    }

    // Clean up old completed/failed requests
    for (const [requestId, request] of this.activeRequests) {
      if (['completed', 'failed', 'timeout'].includes(request.status) &&
          now - request.createdAt.getTime() > 300000) { // 5 minutes
        this.activeRequests.delete(requestId);
      }
    }
  }

  /**
   * Estimate delivery time based on queue and generation speed
   */
  private estimateDeliveryTime(questionCount: number): number {
    // Base time per question (in ms)
    const baseTimePerQuestion = 2000; // 2 seconds
    
    // Factor in current queue length
    const queueFactor = Math.min(this.activeRequests.size * 0.1, 2);
    
    // Calculate estimated time
    const estimatedTime = questionCount * baseTimePerQuestion * (1 + queueFactor);
    
    return Math.min(estimatedTime, 120000); // Cap at 2 minutes
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    if (this.stats.totalRequests === 0) return 0;
    return this.stats.successfulDeliveries / this.stats.totalRequests;
  }

  /**
   * Update average delivery time
   */
  private updateAverageDeliveryTime(deliveryTime: number): void {
    const total = this.stats.averageDeliveryTime * this.stats.successfulDeliveries;
    this.stats.averageDeliveryTime = (total + deliveryTime) / (this.stats.successfulDeliveries);
  }

  /**
   * Get integration statistics
   */
  getStats(): IntegrationStats {
    return { ...this.stats };
  }

  /**
   * Get active requests
   */
  getActiveRequests(): QuestionRequest[] {
    return Array.from(this.activeRequests.values());
  }

  /**
   * Bulk request questions for multiple topics/difficulties
   */
  async bulkRequestQuestions(
    userId: string,
    requests: Array<{
      topic: string;
      difficulty: 'easy' | 'medium' | 'hard';
      count: number;
      questionType?: 'multiple_choice' | 'true_false' | 'open_ended';
      priority?: 'low' | 'medium' | 'high' | 'urgent';
    }>,
    options: {
      chatId?: string;
      timeout?: number;
      deliveryMode?: DeliveryMode;
    } = {}
  ): Promise<{
    bulkRequestId: string;
    individualRequests: Array<{
      requestId: string;
      topic: string;
      difficulty: string;
      status: 'immediate' | 'queued' | 'generating';
    }>;
    totalQuestions: number;
    estimatedDeliveryTime: number;
  }> {
    const bulkRequestId = `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const individualRequests = [];
    let totalQuestions = 0;
    let maxDeliveryTime = 0;

    for (const req of requests) {
      try {
        const result = await this.requestQuestions(
          userId,
          req.topic,
          req.difficulty,
          req.count,
          {
            ...options,
            questionType: req.questionType,
            priority: req.priority,
          }
        );

        individualRequests.push({
          requestId: result.requestId,
          topic: req.topic,
          difficulty: req.difficulty,
          status: result.status,
        });

        totalQuestions += req.count;
        if (result.estimatedDeliveryTime) {
          maxDeliveryTime = Math.max(maxDeliveryTime, result.estimatedDeliveryTime);
        }

      } catch (error) {
        logger.error(`Failed bulk request for ${req.topic}:${req.difficulty}:`, error);
        
        individualRequests.push({
          requestId: '',
          topic: req.topic,
          difficulty: req.difficulty,
          status: 'generating', // Will be marked as failed
        });
      }
    }

    this.emit('bulkRequestProcessed', {
      bulkRequestId,
      individualRequests,
      totalQuestions,
      userId
    });

    return {
      bulkRequestId,
      individualRequests,
      totalQuestions,
      estimatedDeliveryTime: maxDeliveryTime,
    };
  }

  /**
   * Pre-warm question pools based on usage patterns
   */
  async prewarmPools(
    patterns: Array<{
      topic: string;
      difficulty: 'easy' | 'medium' | 'hard';
      expectedUsage: number;
    }>
  ): Promise<void> {
    logger.info('Pre-warming question pools based on usage patterns');

    for (const pattern of patterns) {
      try {
        // Check current pool size
        const status = await questionGeneratorService.getGeneratorStatus();
        const poolStatus = status.poolStatus.find(p => 
          p.topic === pattern.topic && p.difficulty === pattern.difficulty
        );

        if (!poolStatus || poolStatus.currentSize < pattern.expectedUsage * 1.5) {
          // Pre-warm this pool
          await questionGeneratorService.queueGenerationRequest({
            topic: pattern.topic,
            difficulty: pattern.difficulty,
            count: Math.max(20, pattern.expectedUsage),
            questionType: 'multiple_choice',
          }, 'low', 'system-prewarm');

          logger.info(`Pre-warming pool: ${pattern.topic}:${pattern.difficulty} for ${pattern.expectedUsage} expected usage`);
        }
      } catch (error) {
        logger.error(`Error pre-warming pool ${pattern.topic}:${pattern.difficulty}:`, error);
      }
    }
  }

  /**
   * Health check for integration service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    activeRequests: number;
    successRate: number;
    averageDeliveryTime: number;
    issues: string[];
  }> {
    const issues: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check active requests
    const activeCount = this.activeRequests.size;
    if (activeCount > 50) {
      issues.push(`High number of active requests: ${activeCount}`);
      status = 'degraded';
    }

    // Check success rate
    const successRate = this.stats.totalRequests > 0 ? 
      this.stats.successfulDeliveries / this.stats.totalRequests : 1;
    
    if (successRate < 0.8) {
      issues.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
      status = successRate < 0.5 ? 'unhealthy' : 'degraded';
    }

    // Check delivery time
    if (this.stats.averageDeliveryTime > 30000) {
      issues.push(`High average delivery time: ${this.stats.averageDeliveryTime}ms`);
      status = 'degraded';
    }

    return {
      status,
      activeRequests: activeCount,
      successRate,
      averageDeliveryTime: this.stats.averageDeliveryTime,
      issues,
    };
  }
}

export const questionIntegrationService = new QuestionIntegrationService();