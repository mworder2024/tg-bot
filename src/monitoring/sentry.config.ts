import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { logger } from '../utils/structured-logger.js';

/**
 * Initialize Sentry error tracking and performance monitoring
 */
export function initializeSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  
  if (!dsn) {
    logger.warn('Sentry DSN not configured, error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.APP_VERSION || 'unknown',
    
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    
    // Integrations
    integrations: [
      // Automatic instrumentation
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express(),
      new Sentry.Integrations.Postgres(),
      
      // Performance profiling
      nodeProfilingIntegration() as any
    ],
    
    // Before send hook for filtering
    beforeSend(event, hint) {
      // Filter out sensitive data
      if (event.request) {
        // Remove auth headers
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['x-api-key'];
        }
        
        // Remove sensitive body data
        if (event.request.data) {
          const sensitiveFields = ['password', 'privateKey', 'secret', 'token'];
          sensitiveFields.forEach(field => {
            if (event.request.data[field]) {
              event.request.data[field] = '[REDACTED]';
            }
          });
        }
      }
      
      // Filter out certain errors
      const error = hint.originalException;
      if (error && (error as any).message) {
        // Skip rate limit errors
        if ((error as any).message.includes('rate limit')) {
          return null;
        }
        
        // Skip expected validation errors
        if ((error as any).message.includes('validation failed')) {
          return null;
        }
      }
      
      return event;
    },
    
    // Breadcrumb filtering
    beforeBreadcrumb(breadcrumb, hint) {
      // Filter out noisy breadcrumbs
      if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') {
        return null;
      }
      
      // Sanitize data in breadcrumbs
      if (breadcrumb.data) {
        const sensitiveKeys = ['password', 'token', 'key', 'secret'];
        Object.keys(breadcrumb.data).forEach(key => {
          if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
            breadcrumb.data[key] = '[REDACTED]';
          }
        });
      }
      
      return breadcrumb;
    },
    
    // Transport options
    transportOptions: {
      // maxQueueSize: 100, // Not available in current type definition
      // flushTimeout: 2000 // Not available in current type definition
    } as any
  });

  // Set initial user context
  Sentry.configureScope((scope) => {
    scope.setTag('service', 'api');
    scope.setContext('runtime', {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch
    });
  });

  logger.info('Sentry initialized', {
    environment: process.env.NODE_ENV,
    release: process.env.APP_VERSION
  });
}

/**
 * Capture custom error with context
 */
export function captureError(
  error: Error,
  context?: {
    user?: { id: string; username?: string };
    tags?: Record<string, string>;
    extra?: Record<string, any>;
    level?: Sentry.SeverityLevel;
  }
): void {
  Sentry.withScope((scope) => {
    // Set user context
    if (context?.user) {
      scope.setUser({
        id: context.user.id,
        username: context.user.username
      });
    }
    
    // Set tags
    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }
    
    // Set extra context
    if (context?.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    
    // Set level
    if (context?.level) {
      scope.setLevel(context.level);
    }
    
    // Capture the error
    Sentry.captureException(error);
  });
}

/**
 * Create a transaction for performance monitoring
 */
export function startTransaction(
  name: string,
  op: string,
  data?: Record<string, any>
): Sentry.Transaction {
  return Sentry.startTransaction({
    name,
    op,
    data
  });
}

/**
 * Add breadcrumb for better error context
 */
export function addBreadcrumb(breadcrumb: {
  message: string;
  category?: string;
  level?: Sentry.SeverityLevel;
  data?: Record<string, any>;
}): void {
  Sentry.addBreadcrumb({
    message: breadcrumb.message,
    category: breadcrumb.category || 'custom',
    level: breadcrumb.level || 'info',
    data: breadcrumb.data,
    timestamp: Date.now() / 1000
  });
}

/**
 * Capture a message (non-error event)
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, any>
): void {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    
    Sentry.captureMessage(message, level);
  });
}

/**
 * Express middleware for Sentry
 */
export const sentryMiddleware: any = {
  // Request handler (should be first middleware)
  requestHandler: Sentry.Handlers.requestHandler({
    serverName: false,
    user: ['id', 'username'],
    ip: true,
    request: ['method', 'url', 'query_string', 'data']
  }),
  
  // Error handler (should be after all other middleware)
  errorHandler: Sentry.Handlers.errorHandler({
    shouldHandleError(error) {
      // Capture 4xx and 5xx errors
      if ((error as any).statusCode && Number((error as any).statusCode) >= 400) {
        return true;
      }
      return true;
    }
  }),
  
  // Tracing handler for performance monitoring
  tracingHandler: Sentry.Handlers.tracingHandler()
};