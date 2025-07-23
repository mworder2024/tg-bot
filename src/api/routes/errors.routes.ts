import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../utils/error-handler.js';
import { ErrorHandler, ErrorContext, ErrorSeverity } from '../../utils/error-handler.js';
import { ErrorMonitoringService } from '../../services/error-monitoring.service.js';
import { logger } from '../../utils/structured-logger.js';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();
const errorHandler = ErrorHandler.getInstance();
const errorMonitoring = ErrorMonitoringService.getInstance();

// Validation rules
const errorReportValidation = [
  body('message').isString().notEmpty().trim(),
  body('stack').optional().isString(),
  body('errorId').optional().isString(),
  body('userAgent').optional().isString(),
  body('url').optional().isURL(),
  body('componentStack').optional().isString(),
  body('metadata').optional().isObject()
];

// Client error reporting endpoint
router.post('/report',
  errorReportValidation,
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      message,
      stack,
      errorId,
      userAgent,
      url,
      componentStack,
      metadata,
      retryCount
    } = req.body;

    // Create error object
    const error = new Error(message);
    if (stack) error.stack = stack;

    // Build context
    const context: ErrorContext = {
      operation: 'client_error',
      metadata: {
        errorId,
        userAgent: userAgent || req.get('user-agent'),
        url,
        componentStack,
        clientIp: req.ip,
        retryCount,
        ...metadata
      }
    };

    // Add user context if authenticated
    if (req.user) {
      context.userId = req.user.id;
    }

    // Process error
    await errorHandler.handle(error, context, req.logContext);
    await errorMonitoring.captureError(error, context);

    logger.info('Client error reported', {
      errorId,
      message,
      userId: context.userId
    });

    res.json({
      success: true,
      errorId: errorId || 'generated_' + Date.now(),
      message: 'Error reported successfully'
    });
  })
);

// Offline error sync endpoint
router.post('/offline',
  authenticate, // Require authentication for offline sync
  asyncHandler(async (req: Request, res: Response) => {
    const {
      id,
      timestamp,
      error: errorData,
      context,
      retryCount,
      syncedAt
    } = req.body;

    // Recreate error
    const error = new Error(errorData.message);
    error.stack = errorData.stack;
    error.name = errorData.type;

    // Add offline context
    const offlineContext: ErrorContext = {
      ...context,
      userId: req.user?.id,
      metadata: {
        ...context.metadata,
        offline: true,
        originalTimestamp: timestamp,
        syncedAt,
        retryCount
      }
    };

    // Process error
    await errorHandler.handle(error, offlineContext, req.logContext);

    logger.info('Offline error synced', {
      errorId: id,
      userId: req.user?.id,
      delayMinutes: Math.round((Date.now() - new Date(timestamp).getTime()) / 60000)
    });

    res.json({
      success: true,
      id,
      message: 'Offline error synced successfully'
    });
  })
);

// Get error statistics (admin only)
router.get('/stats',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    // Check admin permission
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const stats = errorHandler.getErrorStats();
    const monitoringMetrics = errorMonitoring.getMetrics();
    
    res.json({
      handler: stats,
      monitoring: monitoringMetrics,
      timestamp: new Date()
    });
  })
);

// Get error details (admin only)
router.get('/:errorId',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    // Check admin permission
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { errorId } = req.params;
    
    // This would typically fetch from a database or error tracking service
    // For now, return a placeholder
    res.json({
      errorId,
      message: 'Error details would be fetched from storage',
      timestamp: new Date()
    });
  })
);

// Health check endpoint for error handling system
router.get('/health',
  asyncHandler(async (req: Request, res: Response) => {
    const stats = errorHandler.getErrorStats();
    const circuitBreakers = ['solana-rpc', 'payment-gateway', 'vrf-service'];
    
    const breakerStates = circuitBreakers.map(name => ({
      name,
      state: errorHandler.getCircuitBreaker(name).getState()
    }));

    const healthy = breakerStates.every(b => b.state !== 'open');
    
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      totalErrors: stats.totalErrors,
      circuitBreakers: breakerStates,
      timestamp: new Date()
    });
  })
);

// Test error endpoint (development only)
if (process.env.NODE_ENV === 'development') {
  router.post('/test',
    asyncHandler(async (req: Request, res: Response) => {
      const { severity = 'medium', category = 'test' } = req.body;
      
      const error = new Error('Test error from API');
      const context: ErrorContext = {
        operation: 'test_error',
        metadata: {
          category,
          triggered: 'manual',
          endpoint: '/api/errors/test'
        }
      };

      await errorHandler.handle(error, context, req.logContext);
      await errorMonitoring.captureError(
        error,
        context,
        severity as ErrorSeverity
      );

      res.json({
        success: true,
        message: 'Test error triggered',
        severity,
        category
      });
    })
  );
}

export default router;