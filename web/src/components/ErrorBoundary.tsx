import React, { Component, ErrorInfo, ReactNode } from 'react';
import { 
  Box, 
  Button, 
  Card, 
  CardContent, 
  Typography, 
  Alert,
  Collapse,
  IconButton,
  Stack,
  Divider
} from '@mui/material';
import {
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  BugReport as BugReportIcon,
  Home as HomeIcon
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import axios from 'axios';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
  enableReporting?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string | null;
  showDetails: boolean;
  reportSent: boolean;
  retryCount: number;
}

const ErrorContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '400px',
  padding: theme.spacing(4),
  backgroundColor: theme.palette.background.default,
}));

const ErrorCard = styled(Card)(({ theme }) => ({
  maxWidth: 600,
  width: '100%',
  boxShadow: theme.shadows[4],
}));

const ErrorHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  marginBottom: theme.spacing(2),
}));

const ExpandButton = styled(IconButton)<{ expanded: boolean }>(({ theme, expanded }) => ({
  transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
  transition: theme.transitions.create('transform', {
    duration: theme.transitions.duration.shortest,
  }),
}));

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      showDetails: false,
      reportSent: false,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorInfo: null,
      errorId: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      showDetails: false,
      reportSent: false,
      retryCount: 0,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }

    // Update state with error info
    this.setState({ errorInfo });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Send error to backend
    this.reportError(error, errorInfo);
  }

  reportError = async (error: Error, errorInfo: ErrorInfo) => {
    if (!this.props.enableReporting) return;

    try {
      await axios.post('/api/errors/report', {
        errorId: this.state.errorId,
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        userAgent: navigator.userAgent,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        retryCount: this.state.retryCount,
      });

      this.setState({ reportSent: true });
    } catch (reportError) {
      console.error('Failed to report error:', reportError);
    }
  };

  handleRetry = () => {
    // Increment retry count
    const newRetryCount = this.state.retryCount + 1;
    
    // Reset state to retry
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      retryCount: newRetryCount,
    });

    // Reload the window if too many retries
    if (newRetryCount >= 3) {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  toggleDetails = () => {
    this.setState(prevState => ({
      showDetails: !prevState.showDetails,
    }));
  };

  renderErrorDetails = () => {
    const { error, errorInfo } = this.state;
    if (!error || !errorInfo) return null;

    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" color="error" gutterBottom>
          Error Message:
        </Typography>
        <Typography 
          variant="body2" 
          sx={{ 
            fontFamily: 'monospace',
            backgroundColor: 'grey.100',
            p: 1,
            borderRadius: 1,
            overflowX: 'auto',
          }}
        >
          {error.message}
        </Typography>

        {process.env.NODE_ENV === 'development' && (
          <>
            <Typography variant="subtitle2" color="error" sx={{ mt: 2 }} gutterBottom>
              Stack Trace:
            </Typography>
            <Typography 
              variant="body2" 
              component="pre"
              sx={{ 
                fontFamily: 'monospace',
                backgroundColor: 'grey.100',
                p: 1,
                borderRadius: 1,
                overflowX: 'auto',
                fontSize: '0.75rem',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {error.stack}
            </Typography>

            <Typography variant="subtitle2" color="error" sx={{ mt: 2 }} gutterBottom>
              Component Stack:
            </Typography>
            <Typography 
              variant="body2" 
              component="pre"
              sx={{ 
                fontFamily: 'monospace',
                backgroundColor: 'grey.100',
                p: 1,
                borderRadius: 1,
                overflowX: 'auto',
                fontSize: '0.75rem',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {errorInfo.componentStack}
            </Typography>
          </>
        )}
      </Box>
    );
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      // Default error UI
      return (
        <ErrorContainer>
          <ErrorCard>
            <CardContent>
              <ErrorHeader>
                <ErrorIcon color="error" sx={{ fontSize: 48 }} />
                <Box>
                  <Typography variant="h5" component="h1" gutterBottom>
                    Oops! Something went wrong
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    We encountered an unexpected error. Don't worry, your data is safe.
                  </Typography>
                </Box>
              </ErrorHeader>

              {this.state.reportSent && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Error has been reported to our team. We'll fix it as soon as possible.
                </Alert>
              )}

              {this.state.retryCount > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Retry attempt {this.state.retryCount} of 3
                </Alert>
              )}

              <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
                <Button
                  variant="contained"
                  startIcon={<RefreshIcon />}
                  onClick={this.handleRetry}
                  disabled={this.state.retryCount >= 3}
                >
                  Try Again
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<HomeIcon />}
                  onClick={this.handleGoHome}
                >
                  Go Home
                </Button>
                {(this.props.showDetails ?? process.env.NODE_ENV === 'development') && (
                  <Button
                    variant="text"
                    endIcon={
                      <ExpandButton 
                        expanded={this.state.showDetails}
                        onClick={this.toggleDetails}
                        size="small"
                      >
                        <ExpandMoreIcon />
                      </ExpandButton>
                    }
                    onClick={this.toggleDetails}
                  >
                    Details
                  </Button>
                )}
              </Stack>

              <Collapse in={this.state.showDetails}>
                <Divider sx={{ my: 2 }} />
                {this.renderErrorDetails()}
                
                {this.state.errorId && (
                  <Typography 
                    variant="caption" 
                    color="text.secondary" 
                    sx={{ display: 'block', mt: 2 }}
                  >
                    Error ID: {this.state.errorId}
                  </Typography>
                )}
              </Collapse>
            </CardContent>
          </ErrorCard>
        </ErrorContainer>
      );
    }

    return this.props.children;
  }
}

// HOC for wrapping components with error boundary
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const ComponentWithErrorBoundary = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  ComponentWithErrorBoundary.displayName = 
    `withErrorBoundary(${Component.displayName || Component.name || 'Component'})`;

  return ComponentWithErrorBoundary;
}

// Hook for error handling in functional components
export function useErrorHandler() {
  return (error: Error, errorInfo?: ErrorInfo) => {
    console.error('Error caught by hook:', error, errorInfo);
    
    // You can add custom error handling logic here
    // For example, sending to analytics or showing notifications
    
    // Re-throw to let Error Boundary catch it
    throw error;
  };
}