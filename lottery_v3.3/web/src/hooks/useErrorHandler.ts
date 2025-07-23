import { useCallback, useContext, useEffect, useRef } from 'react';
import { useSnackbar } from 'notistack';
import { useDispatch } from 'react-redux';
import axios from 'axios';

// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Error context for web applications
interface WebErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  metadata?: any;
}

// Error reporting payload
interface ErrorReport {
  message: string;
  stack?: string;
  errorId?: string;
  userAgent: string;
  url: string;
  componentStack?: string;
  metadata?: any;
  retryCount?: number;
}

// Hook options
interface UseErrorHandlerOptions {
  enableReporting?: boolean;
  enableNotifications?: boolean;
  defaultSeverity?: ErrorSeverity;
  retryAttempts?: number;
  customNotifications?: {
    [key in ErrorSeverity]?: {
      variant: 'default' | 'error' | 'success' | 'warning' | 'info';
      persist?: boolean;
    };
  };
}

// Error handler hook
export function useErrorHandler(options: UseErrorHandlerOptions = {}) {
  const {
    enableReporting = true,
    enableNotifications = true,
    defaultSeverity = ErrorSeverity.MEDIUM,
    retryAttempts = 3,
    customNotifications = {
      [ErrorSeverity.LOW]: { variant: 'info' },
      [ErrorSeverity.MEDIUM]: { variant: 'warning' },
      [ErrorSeverity.HIGH]: { variant: 'error' },
      [ErrorSeverity.CRITICAL]: { variant: 'error', persist: true }
    }
  } = options;

  const { enqueueSnackbar } = useSnackbar();
  const dispatch = useDispatch();
  const reportedErrors = useRef(new Set<string>());
  const retryCount = useRef(new Map<string, number>());

  // Error ID generation
  const generateErrorId = useCallback((error: Error): string => {
    const timestamp = Date.now();
    const hash = error.message.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '');
    return `web_${timestamp}_${hash}`;
  }, []);

  // Get user-friendly error message
  const getUserFriendlyMessage = useCallback((error: Error): string => {
    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('fetch')) {
      return 'Network connection issue. Please check your internet connection.';
    } else if (message.includes('unauthorized') || message.includes('401')) {
      return 'Session expired. Please sign in again.';
    } else if (message.includes('forbidden') || message.includes('403')) {
      return 'You don\'t have permission to perform this action.';
    } else if (message.includes('not found') || message.includes('404')) {
      return 'The requested resource was not found.';
    } else if (message.includes('validation') || message.includes('400')) {
      return 'Please check your input and try again.';
    } else if (message.includes('server') || message.includes('500')) {
      return 'Server error. Please try again later.';
    } else if (message.includes('timeout')) {
      return 'Request timed out. Please try again.';
    } else if (message.includes('quota') || message.includes('limit')) {
      return 'Rate limit exceeded. Please wait and try again.';
    } else if (message.includes('blockchain') || message.includes('wallet')) {
      return 'Blockchain operation failed. Please try again.';
    }
    
    return 'Something went wrong. Please try again later.';
  }, []);

  // Report error to backend
  const reportError = useCallback(async (
    error: Error,
    context: WebErrorContext = {},
    severity: ErrorSeverity = defaultSeverity
  ): Promise<void> => {
    if (!enableReporting) return;

    const errorId = generateErrorId(error);
    
    // Prevent duplicate reporting
    if (reportedErrors.current.has(errorId)) {
      return;
    }
    reportedErrors.current.add(errorId);

    const report: ErrorReport = {
      message: error.message,
      stack: error.stack,
      errorId,
      userAgent: navigator.userAgent,
      url: window.location.href,
      metadata: {
        severity,
        timestamp: new Date().toISOString(),
        ...context
      }
    };

    try {
      await axios.post('/api/errors/report', report);
      console.info(`Error reported: ${errorId}`);
    } catch (reportingError) {
      console.error('Failed to report error:', reportingError);
      
      // Store for offline sync
      const offlineErrors = JSON.parse(localStorage.getItem('offlineErrors') || '[]');
      offlineErrors.push(report);
      localStorage.setItem('offlineErrors', JSON.stringify(offlineErrors));
    }
  }, [enableReporting, defaultSeverity, generateErrorId]);

  // Show notification
  const showNotification = useCallback((
    error: Error,
    severity: ErrorSeverity = defaultSeverity
  ): void => {
    if (!enableNotifications) return;

    const userMessage = getUserFriendlyMessage(error);
    const notificationConfig = customNotifications[severity] || { variant: 'error' };

    enqueueSnackbar(userMessage, {
      variant: notificationConfig.variant,
      persist: notificationConfig.persist,
      action: severity === ErrorSeverity.CRITICAL ? (key) => (
        <button onClick={() => window.location.reload()}>
          Reload Page
        </button>
      ) : undefined
    });
  }, [enableNotifications, defaultSeverity, getUserFriendlyMessage, enqueueSnackbar, customNotifications]);

  // Main error handler
  const handleError = useCallback(async (
    error: Error,
    context: WebErrorContext = {},
    severity: ErrorSeverity = defaultSeverity,
    showNotify: boolean = true
  ): Promise<void> => {
    console.error('Error handled by useErrorHandler:', error, context);

    // Show notification
    if (showNotify) {
      showNotification(error, severity);
    }

    // Report error
    await reportError(error, context, severity);

    // Dispatch to Redux store if needed
    dispatch({
      type: 'errors/errorOccurred',
      payload: {
        error: {
          message: error.message,
          name: error.name
        },
        context,
        severity,
        timestamp: new Date().toISOString()
      }
    });
  }, [defaultSeverity, showNotification, reportError, dispatch]);

  // Handle async operations with error catching
  const handleAsync = useCallback(async <T>(
    asyncOperation: () => Promise<T>,
    context: WebErrorContext = {},
    severity: ErrorSeverity = defaultSeverity
  ): Promise<T | null> => {
    try {
      return await asyncOperation();
    } catch (error) {
      await handleError(error as Error, context, severity);
      return null;
    }
  }, [handleError, defaultSeverity]);

  // Handle async operations with retry logic
  const handleAsyncWithRetry = useCallback(async <T>(
    asyncOperation: () => Promise<T>,
    context: WebErrorContext = {},
    severity: ErrorSeverity = defaultSeverity
  ): Promise<T | null> => {
    const operationKey = `${context.component || 'unknown'}_${context.action || 'unknown'}`;
    const currentRetryCount = retryCount.current.get(operationKey) || 0;

    try {
      const result = await asyncOperation();
      // Success - reset retry count
      retryCount.current.delete(operationKey);
      return result;
    } catch (error) {
      const err = error as Error;
      
      // Increment retry count
      retryCount.current.set(operationKey, currentRetryCount + 1);

      // Check if we should retry
      if (currentRetryCount < retryAttempts && isRetryableError(err)) {
        console.info(`Retrying operation (${currentRetryCount + 1}/${retryAttempts}):`, operationKey);
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, currentRetryCount), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return handleAsyncWithRetry(asyncOperation, context, severity);
      } else {
        // Max retries reached or non-retryable error
        retryCount.current.delete(operationKey);
        await handleError(err, {
          ...context,
          retryCount: currentRetryCount
        }, severity);
        return null;
      }
    }
  }, [handleError, defaultSeverity, retryAttempts]);

  // Check if error is retryable
  const isRetryableError = useCallback((error: Error): boolean => {
    const message = error.message.toLowerCase();
    const retryablePatterns = [
      'network',
      'timeout',
      'connection',
      'fetch',
      'temporary',
      'rate limit',
      '429',
      '502',
      '503',
      '504'
    ];
    
    return retryablePatterns.some(pattern => message.includes(pattern));
  }, []);

  // Create error boundary error handler
  const createErrorBoundaryHandler = useCallback((componentName: string) => {
    return (error: Error, errorInfo: any) => {
      handleError(error, {
        component: componentName,
        action: 'render',
        metadata: {
          componentStack: errorInfo.componentStack
        }
      }, ErrorSeverity.HIGH, false); // Don't show notification for boundary errors
    };
  }, [handleError]);

  // Sync offline errors when online
  const syncOfflineErrors = useCallback(async (): Promise<void> => {
    if (!navigator.onLine) return;

    const offlineErrors = JSON.parse(localStorage.getItem('offlineErrors') || '[]');
    
    if (offlineErrors.length === 0) return;

    console.info(`Syncing ${offlineErrors.length} offline errors`);
    
    for (const errorReport of offlineErrors) {
      try {
        await axios.post('/api/errors/offline', {
          ...errorReport,
          syncedAt: new Date().toISOString()
        });
      } catch (syncError) {
        console.error('Failed to sync offline error:', syncError);
        break; // Stop syncing if one fails
      }
    }
    
    // Clear synced errors
    localStorage.removeItem('offlineErrors');
    console.info('Offline errors synced successfully');
  }, []);

  // Setup online event listener for syncing
  useEffect(() => {
    const handleOnline = () => {
      syncOfflineErrors();
    };

    window.addEventListener('online', handleOnline);
    
    // Sync on mount if online
    if (navigator.onLine) {
      syncOfflineErrors();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [syncOfflineErrors]);

  // Clear reported errors periodically to prevent memory leaks
  useEffect(() => {
    const interval = setInterval(() => {
      reportedErrors.current.clear();
      retryCount.current.clear();
    }, 5 * 60 * 1000); // Clear every 5 minutes

    return () => clearInterval(interval);
  }, []);

  return {
    handleError,
    handleAsync,
    handleAsyncWithRetry,
    createErrorBoundaryHandler,
    getUserFriendlyMessage,
    syncOfflineErrors,
    ErrorSeverity
  };
}

// Higher-order component for automatic error handling
export function withErrorHandling<T extends object>(
  Component: React.ComponentType<T>,
  options: UseErrorHandlerOptions & { componentName?: string } = {}
) {
  const { componentName = Component.displayName || Component.name, ...hookOptions } = options;

  return function ComponentWithErrorHandling(props: T) {
    const { createErrorBoundaryHandler } = useErrorHandler(hookOptions);
    
    // This would typically be used with an Error Boundary
    // For now, we'll just pass the handler through props
    const enhancedProps = {
      ...props,
      onError: createErrorBoundaryHandler(componentName)
    } as T;

    return <Component {...enhancedProps} />;
  };
}

// Axios interceptor for automatic error handling
export function setupAxiosErrorHandling(): void {
  // Response interceptor
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      // This would be handled by the component using the hook
      // We can add global handling here if needed
      
      if (error.response?.status === 401) {
        // Handle authentication errors globally
        window.location.href = '/login';
      }
      
      return Promise.reject(error);
    }
  );
}