import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { questionGeneratorService } from '../../services/question-generator.service.js';
import { logger } from '../../utils/logger.js';
import { authenticateToken } from '../middleware/simple-auth.js';

export const questionGeneratorRouter = Router();

// Validation middleware
const validateRequest = (req: Request, res: Response, next: Function) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

/**
 * @route GET /api/question-generator/status
 * @desc Get generator service status and metrics
 * @access Private
 */
questionGeneratorRouter.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const status = await questionGeneratorService.getGeneratorStatus();
    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting generator status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get generator status',
      message: (error as Error).message
    });
  }
});

/**
 * @route GET /api/question-generator/health
 * @desc Health check for question generator service
 * @access Public
 */
questionGeneratorRouter.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await questionGeneratorService.healthCheck();
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 206 : 503;
    
    res.status(statusCode).json({
      success: health.status !== 'unhealthy',
      health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error checking generator health:', error);
    res.status(503).json({
      success: false,
      health: {
        status: 'unhealthy',
        pools: 0,
        queueLength: 0,
        rateLimitStatus: 'error',
        lastError: (error as Error).message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route POST /api/question-generator/generate
 * @desc Request immediate question generation
 * @access Private
 */
questionGeneratorRouter.post('/generate',
  authenticateToken,
    body('topic').isString().isLength({ min: 1, max: 255 }).withMessage('Topic is required and must be 1-255 characters'),
    body('difficulty').isIn(['easy', 'medium', 'hard']).withMessage('Difficulty must be easy, medium, or hard'),
    body('count').isInt({ min: 1, max: 20 }).withMessage('Count must be between 1 and 20'),
    body('questionType').isIn(['multiple_choice', 'true_false', 'open_ended']).withMessage('Invalid question type'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority'),
    body('context').optional().isString().isLength({ max: 1000 }).withMessage('Context must be less than 1000 characters'),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { topic, difficulty, count, questionType, priority = 'medium', context } = req.body;
      const userId = (req as any).user?.id || 'api-user';

      const requestId = await questionGeneratorService.queueGenerationRequest({
        topic,
        difficulty,
        count,
        questionType,
        context
      }, priority, userId);

      res.json({
        success: true,
        data: {
          requestId,
          status: 'queued',
          estimatedCompletionTime: new Date(Date.now() + 60000).toISOString()
        },
        message: 'Question generation request queued successfully'
      });
    } catch (error) {
      logger.error('Error queuing generation request:', error);
      
      if ((error as Error).message.includes('Rate limit')) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: (error as Error).message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to queue generation request',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route GET /api/question-generator/questions/:topic/:difficulty
 * @desc Get questions from pool for immediate use
 * @access Private
 */
questionGeneratorRouter.get('/questions/:topic/:difficulty',
  authenticateToken,
    param('topic').isString().isLength({ min: 1, max: 255 }).withMessage('Invalid topic'),
    param('difficulty').isIn(['easy', 'medium', 'hard']).withMessage('Invalid difficulty'),
    query('count').optional().isInt({ min: 1, max: 50 }).withMessage('Count must be between 1 and 50'),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { topic, difficulty } = req.params;
      const count = parseInt(req.query.count as string) || 5;
      const userId = (req as any).user?.id;

      const questions = await questionGeneratorService.getQuestionsFromPool(
        topic,
        difficulty as 'easy' | 'medium' | 'hard',
        count,
        userId
      );

      if (questions.length === 0) {
        return res.status(202).json({
          success: true,
          data: {
            questions: [],
            available: 0,
            requested: count
          },
          message: 'No questions currently available. Generation has been queued.',
          status: 'generating'
        });
      }

      res.json({
        success: true,
        data: {
          questions,
          available: questions.length,
          requested: count,
          topic,
          difficulty
        },
        message: `Retrieved ${questions.length} questions from pool`
      });
    } catch (error) {
      logger.error('Error getting questions from pool:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get questions from pool',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route GET /api/question-generator/queue/:requestId
 * @desc Check status of a generation request
 * @access Private
 */
questionGeneratorRouter.get('/queue/:requestId',
  authenticateToken,
    param('requestId').isUUID().withMessage('Invalid request ID'),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { requestId } = req.params;
      
      // Query database for request status
      const result = await questionGeneratorService['db'].query(
        'SELECT * FROM generation_queue WHERE id = $1',
        [requestId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Request not found',
          message: 'The specified generation request was not found'
        });
      }

      const request = result.rows[0];
      res.json({
        success: true,
        data: {
          id: request.id,
          status: request.status,
          priority: request.priority,
          createdAt: request.created_at,
          scheduledFor: request.scheduled_for,
          retryCount: request.retry_count,
          maxRetries: request.max_retries,
          error: request.error,
          result: request.result,
          request: request.request
        }
      });
    } catch (error) {
      logger.error('Error checking request status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check request status',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route GET /api/question-generator/pools
 * @desc Get information about all question pools
 * @access Private
 */
questionGeneratorRouter.get('/pools', authenticateToken, async (req: Request, res: Response) => {
  try {
    const status = await questionGeneratorService.getGeneratorStatus();
    
    res.json({
      success: true,
      data: {
        pools: status.poolStatus,
        totalPools: status.poolStatus.length,
        healthyPools: status.poolStatus.filter(p => !p.isStale && p.currentSize >= p.targetSize * 0.8).length,
        stalePools: status.poolStatus.filter(p => p.isStale).length,
        lowPools: status.poolStatus.filter(p => p.currentSize < p.targetSize * 0.5).length
      }
    });
  } catch (error) {
    logger.error('Error getting pool information:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pool information',
      message: (error as Error).message
    });
  }
});

/**
 * @route GET /api/question-generator/analytics
 * @desc Get generation analytics and metrics
 * @access Private
 */
questionGeneratorRouter.get('/analytics', authenticateToken, async (req: Request, res: Response) => {
  try {
    const status = await questionGeneratorService.getGeneratorStatus();
    
    // Calculate summary metrics
    const totalGenerated = status.analytics.reduce((sum, a) => sum + a.totalGenerated, 0);
    const avgSuccessRate = status.analytics.reduce((sum, a) => sum + a.successRate, 0) / status.analytics.length;
    const avgResponseTime = status.analytics.reduce((sum, a) => sum + a.averageResponseTime, 0) / status.analytics.length;

    res.json({
      success: true,
      data: {
        summary: {
          totalGenerated,
          avgSuccessRate: Math.round(avgSuccessRate * 100) / 100,
          avgResponseTime: Math.round(avgResponseTime),
          activeTopics: status.analytics.length,
          queueStatus: status.queueStatus
        },
        byTopic: status.analytics,
        trends: {
          // Could add historical trending data here
          recentPerformance: 'stable',
          topTopics: status.analytics
            .sort((a, b) => b.usageFrequency - a.usageFrequency)
            .slice(0, 5)
            .map(a => ({ topic: a.topic, difficulty: a.difficulty, usage: a.usageFrequency }))
        }
      }
    });
  } catch (error) {
    logger.error('Error getting analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics',
      message: (error as Error).message
    });
  }
});

/**
 * @route POST /api/question-generator/pools/:topic/:difficulty/refresh
 * @desc Manually trigger pool refresh
 * @access Private
 */
questionGeneratorRouter.post('/pools/:topic/:difficulty/refresh',
  authenticateToken,
    param('topic').isString().isLength({ min: 1, max: 255 }).withMessage('Invalid topic'),
    param('difficulty').isIn(['easy', 'medium', 'hard']).withMessage('Invalid difficulty'),
    body('count').optional().isInt({ min: 1, max: 50 }).withMessage('Count must be between 1 and 50'),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { topic, difficulty } = req.params;
      const count = req.body.count || 10;
      const userId = (req as any).user?.id || 'admin';

      const requestId = await questionGeneratorService.queueGenerationRequest({
        topic,
        difficulty: difficulty as 'easy' | 'medium' | 'hard',
        count,
        questionType: 'multiple_choice'
      }, 'high', userId);

      res.json({
        success: true,
        data: {
          requestId,
          message: `Pool refresh queued for ${topic} (${difficulty})`
        }
      });
    } catch (error) {
      logger.error('Error refreshing pool:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to refresh pool',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route GET /api/question-generator/rate-limits
 * @desc Get current rate limit status
 * @access Private
 */
questionGeneratorRouter.get('/rate-limits', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    
    // Get rate limit info from Redis
    const userLimitKey = `user:${userId}`;
    const globalLimitKey = 'generation:global';
    
    const userLimitInfo = await questionGeneratorService['getRateLimitInfo'](userLimitKey);
    const globalLimitInfo = await questionGeneratorService['getRateLimitInfo'](globalLimitKey);

    res.json({
      success: true,
      data: {
        user: {
          requestsThisMinute: userLimitInfo.requestsThisMinute,
          requestsThisHour: userLimitInfo.requestsThisHour,
          requestsToday: userLimitInfo.requestsToday,
          resetTimeMinute: userLimitInfo.resetTimeMinute,
          resetTimeHour: userLimitInfo.resetTimeHour,
          resetTimeDay: userLimitInfo.resetTimeDay,
          isLimited: userLimitInfo.isLimited
        },
        global: {
          requestsThisMinute: globalLimitInfo.requestsThisMinute,
          requestsThisHour: globalLimitInfo.requestsThisHour,
          isLimited: globalLimitInfo.isLimited
        },
        limits: {
          user: {
            perMinute: 5,
            perHour: 50,
            perDay: 200
          },
          global: {
            perMinute: 50,
            perHour: 500
          }
        }
      }
    });
  } catch (error) {
    logger.error('Error getting rate limit status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get rate limit status',
      message: (error as Error).message
    });
  }
});

/**
 * @route POST /api/question-generator/validate
 * @desc Validate question quality without generating
 * @access Private
 */
questionGeneratorRouter.post('/validate',
  authenticateToken,
    body('questions').isArray({ min: 1, max: 10 }).withMessage('Questions array is required (1-10 items)'),
    body('questions.*.question').isString().isLength({ min: 10, max: 500 }).withMessage('Question text must be 10-500 characters'),
    body('questions.*.type').isIn(['multiple_choice', 'true_false', 'open_ended']).withMessage('Invalid question type'),
    body('questions.*.difficulty').isIn(['easy', 'medium', 'hard']).withMessage('Invalid difficulty'),
    body('questions.*.topic').isString().isLength({ min: 1, max: 255 }).withMessage('Topic is required'),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { questions } = req.body;
      
      const validationResults = [];
      
      for (const question of questions) {
        const quality = await questionGeneratorService['calculateQuestionQuality'](question);
        validationResults.push({
          question: question.question.substring(0, 100) + '...',
          quality,
          isValid: quality.overallQuality >= 0.8,
          recommendations: generateQualityRecommendations(quality)
        });
      }

      res.json({
        success: true,
        data: {
          results: validationResults,
          summary: {
            total: questions.length,
            valid: validationResults.filter(r => r.isValid).length,
            avgQuality: validationResults.reduce((sum, r) => sum + r.quality.overallQuality, 0) / questions.length
          }
        }
      });
    } catch (error) {
      logger.error('Error validating questions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to validate questions',
        message: (error as Error).message
      });
    }
  }
);

/**
 * Generate recommendations based on quality metrics
 */
function generateQualityRecommendations(quality: any): string[] {
  const recommendations = [];
  
  if (quality.readabilityScore < 0.7) {
    recommendations.push('Consider simplifying the question wording for better readability');
  }
  
  if (quality.difficultyConsistency < 0.7) {
    recommendations.push('Question difficulty may not match the stated level');
  }
  
  if (quality.answerDistribution < 0.7) {
    recommendations.push('Consider balancing the length and plausibility of answer options');
  }
  
  if (quality.topicRelevance < 0.7) {
    recommendations.push('Question may not be closely related to the specified topic');
  }
  
  if (quality.uniquenessScore < 0.7) {
    recommendations.push('Question may be too similar to existing questions');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('Question meets all quality criteria');
  }
  
  return recommendations;
}

export default questionGeneratorRouter;