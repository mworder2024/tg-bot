import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { CaptureConsole } from '@sentry/integrations';
import { logger } from '../utils/structured-logger.js';
import { ErrorHandler, ErrorContext, ErrorSeverity } from '../utils/error-handler.js';
import axios from 'axios';

// Error monitoring configuration
interface MonitoringConfig {
  sentryDsn?: string;
  environment: string;
  enableProfiling: boolean;
  enableConsoleCapture: boolean;
  tracesSampleRate: number;
  profilesSampleRate: number;
  attachStacktrace: boolean;
  maxBreadcrumbs: number;
  customWebhookUrl?: string;
  slackWebhookUrl?: string;
  pagerDutyKey?: string;
}

// Alert channels
export enum AlertChannel {
  SENTRY = 'sentry',
  SLACK = 'slack',
  PAGERDUTY = 'pagerduty',
  WEBHOOK = 'webhook',
  EMAIL = 'email'
}

// Alert configuration
export interface AlertConfig {
  channel: AlertChannel;
  severity: ErrorSeverity[];
  filters?: string[];
  throttle?: number; // Minutes between alerts
}

export class ErrorMonitoringService {
  private static instance: ErrorMonitoringService;
  private config: MonitoringConfig;
  private errorHandler: ErrorHandler;
  private alertConfigs: AlertConfig[] = [];
  private lastAlerts: Map<string, Date> = new Map();
  private metrics: {
    totalErrors: number;
    errorsBySeverity: Record<ErrorSeverity, number>;
    errorsByCategory: Record<string, number>;
    alertsSent: number;
  };

  private constructor(config: MonitoringConfig) {
    this.config = config;
    this.errorHandler = ErrorHandler.getInstance();
    this.metrics = {
      totalErrors: 0,
      errorsBySeverity: {
        [ErrorSeverity.LOW]: 0,
        [ErrorSeverity.MEDIUM]: 0,
        [ErrorSeverity.HIGH]: 0,
        [ErrorSeverity.CRITICAL]: 0
      },
      errorsByCategory: {},
      alertsSent: 0
    };
    
    this.initializeSentry();
    this.setupAlertChannels();
  }

  static initialize(config: MonitoringConfig): ErrorMonitoringService {
    if (!ErrorMonitoringService.instance) {
      ErrorMonitoringService.instance = new ErrorMonitoringService(config);
    }
    return ErrorMonitoringService.instance;
  }

  static getInstance(): ErrorMonitoringService {
    if (!ErrorMonitoringService.instance) {
      throw new Error('ErrorMonitoringService not initialized');
    }
    return ErrorMonitoringService.instance;
  }

  // Initialize Sentry
  private initializeSentry(): void {
    if (!this.config.sentryDsn) {
      logger.warn('Sentry DSN not provided, skipping Sentry initialization');
      return;
    }

    const integrations = [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express(),
    ];

    if (this.config.enableProfiling) {
      integrations.push(nodeProfilingIntegration() as any);
    }

    if (this.config.enableConsoleCapture) {
      integrations.push(new CaptureConsole({ levels: ['error', 'warn'] }));
    }

    Sentry.init({
      dsn: this.config.sentryDsn,
      environment: this.config.environment,
      integrations,
      tracesSampleRate: this.config.tracesSampleRate,
      profilesSampleRate: this.config.profilesSampleRate,
      attachStacktrace: this.config.attachStacktrace,
      maxBreadcrumbs: this.config.maxBreadcrumbs,
      beforeSend: (event, hint) => {
        // Custom filtering and enrichment
        return this.enrichSentryEvent(event, hint);
      },
      beforeBreadcrumb: (breadcrumb) => {
        // Filter sensitive data from breadcrumbs
        return this.filterBreadcrumb(breadcrumb);
      }
    });

    logger.info('Sentry initialized successfully');
  }

  // Setup alert channels
  private setupAlertChannels(): void {
    // Default alert configurations
    this.alertConfigs = [
      {
        channel: AlertChannel.SENTRY,
        severity: [ErrorSeverity.HIGH, ErrorSeverity.CRITICAL]
      },
      {
        channel: AlertChannel.SLACK,
        severity: [ErrorSeverity.CRITICAL],
        throttle: 5 // 5 minutes between alerts
      },
      {
        channel: AlertChannel.PAGERDUTY,
        severity: [ErrorSeverity.CRITICAL],
        filters: ['payment', 'blockchain', 'security'],
        throttle: 15
      }
    ];
  }

  // Capture and process error
  async captureError(
    error: Error,
    context: ErrorContext,
    severity?: ErrorSeverity
  ): Promise<void> {
    // Update metrics
    this.updateMetrics(error, severity);

    // Capture in Sentry
    const sentryId = Sentry.captureException(error, {
      level: this.mapSeverityToSentryLevel(severity),
      tags: {
        category: context.metadata?.category || 'unknown',
        operation: context.operation,
        userId: context.userId
      },
      extra: context.metadata,
      user: context.userId ? { id: context.userId } : undefined
    });

    // Process alerts
    await this.processAlerts(error, context, severity || ErrorSeverity.MEDIUM, sentryId);

    // Custom webhook
    if (this.config.customWebhookUrl) {
      await this.sendCustomWebhook(error, context, severity, sentryId);
    }
  }

  // Process alerts based on configuration
  private async processAlerts(
    error: Error,
    context: ErrorContext,
    severity: ErrorSeverity,
    sentryId: string
  ): Promise<void> {
    for (const alertConfig of this.alertConfigs) {
      // Check severity
      if (!alertConfig.severity.includes(severity)) continue;

      // Check filters
      if (alertConfig.filters) {
        const matchesFilter = alertConfig.filters.some(filter => 
          error.message.toLowerCase().includes(filter) ||
          context.operation?.toLowerCase().includes(filter)
        );
        if (!matchesFilter) continue;
      }

      // Check throttle
      if (alertConfig.throttle) {
        const alertKey = `${alertConfig.channel}_${error.constructor.name}`;
        const lastAlert = this.lastAlerts.get(alertKey);
        
        if (lastAlert) {
          const minutesSinceLastAlert = (Date.now() - lastAlert.getTime()) / 60000;
          if (minutesSinceLastAlert < alertConfig.throttle) continue;
        }
        
        this.lastAlerts.set(alertKey, new Date());
      }

      // Send alert
      await this.sendAlert(alertConfig.channel, error, context, severity, sentryId);
    }
  }

  // Send alert to specific channel
  private async sendAlert(
    channel: AlertChannel,
    error: Error,
    context: ErrorContext,
    severity: ErrorSeverity,
    sentryId: string
  ): Promise<void> {
    try {
      switch (channel) {
        case AlertChannel.SLACK:
          await this.sendSlackAlert(error, context, severity, sentryId);
          break;
        case AlertChannel.PAGERDUTY:
          await this.sendPagerDutyAlert(error, context, severity, sentryId);
          break;
        case AlertChannel.WEBHOOK:
          await this.sendWebhookAlert(error, context, severity, sentryId);
          break;
        case AlertChannel.EMAIL:
          await this.sendEmailAlert(error, context, severity, sentryId);
          break;
      }
      
      this.metrics.alertsSent++;
    } catch (alertError) {
      logger.error('Failed to send alert', {
        channel,
        error: {
          name: (alertError as Error).name,
          message: (alertError as Error).message,
          stack: (alertError as Error).stack
        },
        originalError: error.message
      });
    }
  }

  // Send Slack alert
  private async sendSlackAlert(
    error: Error,
    context: ErrorContext,
    severity: ErrorSeverity,
    sentryId: string
  ): Promise<void> {
    if (!this.config.slackWebhookUrl) return;

    const color = severity === ErrorSeverity.CRITICAL ? 'danger' :
                  severity === ErrorSeverity.HIGH ? 'warning' : 'warning';

    const payload = {
      attachments: [{
        color,
        title: `🚨 ${severity.toUpperCase()} Error Alert`,
        text: error.message,
        fields: [
          {
            title: 'Error Type',
            value: error.constructor.name,
            short: true
          },
          {
            title: 'Severity',
            value: severity,
            short: true
          },
          {
            title: 'Operation',
            value: context.operation || 'Unknown',
            short: true
          },
          {
            title: 'User ID',
            value: context.userId || 'N/A',
            short: true
          },
          {
            title: 'Environment',
            value: this.config.environment,
            short: true
          },
          {
            title: 'Sentry ID',
            value: sentryId,
            short: true
          }
        ],
        footer: 'Lottery Bot Error Monitor',
        ts: Math.floor(Date.now() / 1000)
      }]
    };

    await axios.post(this.config.slackWebhookUrl, payload);
  }

  // Send PagerDuty alert
  private async sendPagerDutyAlert(
    error: Error,
    context: ErrorContext,
    severity: ErrorSeverity,
    sentryId: string
  ): Promise<void> {
    if (!this.config.pagerDutyKey) return;

    const payload = {
      routing_key: this.config.pagerDutyKey,
      event_action: 'trigger',
      dedup_key: `${error.constructor.name}_${context.operation}`,
      payload: {
        summary: error.message,
        severity: severity === ErrorSeverity.CRITICAL ? 'critical' : 'error',
        source: 'lottery-bot',
        component: context.operation,
        group: error.constructor.name,
        class: 'application',
        custom_details: {
          error_type: error.constructor.name,
          user_id: context.userId,
          sentry_id: sentryId,
          environment: this.config.environment,
          metadata: context.metadata
        }
      }
    };

    await axios.post('https://events.pagerduty.com/v2/enqueue', payload);
  }

  // Send webhook alert
  private async sendWebhookAlert(
    error: Error,
    context: ErrorContext,
    severity: ErrorSeverity,
    sentryId: string
  ): Promise<void> {
    if (!this.config.customWebhookUrl) return;

    const payload = {
      error: {
        message: error.message,
        type: error.constructor.name,
        stack: error.stack
      },
      context,
      severity,
      sentryId,
      environment: this.config.environment,
      timestamp: new Date().toISOString(),
      metrics: this.getMetrics()
    };

    await axios.post(this.config.customWebhookUrl, payload);
  }

  // Send email alert (placeholder)
  private async sendEmailAlert(
    error: Error,
    context: ErrorContext,
    severity: ErrorSeverity,
    sentryId: string
  ): Promise<void> {
    // Email implementation would go here
    // This would typically use a service like SendGrid, SES, etc.
    logger.info('Email alert would be sent here', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      },
      severity,
      sentryId
    });
  }

  // Send custom webhook
  private async sendCustomWebhook(
    error: Error,
    context: ErrorContext,
    severity?: ErrorSeverity,
    sentryId?: string
  ): Promise<void> {
    if (!this.config.customWebhookUrl) return;

    try {
      await axios.post(this.config.customWebhookUrl, {
        error: {
          message: error.message,
          type: error.constructor.name,
          stack: error.stack
        },
        context,
        severity,
        sentryId,
        timestamp: new Date().toISOString()
      });
    } catch (webhookError) {
      logger.error('Failed to send custom webhook', {
        error: {
          name: (webhookError as Error).name,
          message: (webhookError as Error).message,
          stack: (webhookError as Error).stack
        },
        originalError: error.message
      });
    }
  }

  // Enrich Sentry event
  private enrichSentryEvent(event: Sentry.Event, hint: Sentry.EventHint): Sentry.Event | null {
    // Add custom fingerprinting
    if (event.exception?.values?.[0]) {
      const error = event.exception.values[0];
      event.fingerprint = [
        error.type || 'unknown',
        error.value?.substring(0, 50) || 'no-message'
      ];
    }

    // Add custom tags
    event.tags = {
      ...event.tags,
      handled: (hint.originalException as any)?.handled ?? true,
      category: hint.data?.category || 'unknown'
    };

    // Filter sensitive data
    if (event.request?.data) {
      event.request.data = this.filterSensitiveData(event.request.data);
    }

    return event;
  }

  // Filter breadcrumb
  private filterBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
    // Filter out sensitive breadcrumbs
    if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') {
      return null;
    }

    // Filter sensitive data from breadcrumb data
    if (breadcrumb.data) {
      breadcrumb.data = this.filterSensitiveData(breadcrumb.data);
    }

    return breadcrumb;
  }

  // Filter sensitive data
  private filterSensitiveData(data: any): any {
    if (typeof data !== 'object' || data === null) return data;

    const filtered = { ...data };
    const sensitiveKeys = ['password', 'token', 'secret', 'privateKey', 'seed', 'mnemonic'];

    for (const key of Object.keys(filtered)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        filtered[key] = '[REDACTED]';
      } else if (typeof filtered[key] === 'object') {
        filtered[key] = this.filterSensitiveData(filtered[key]);
      }
    }

    return filtered;
  }

  // Map severity to Sentry level
  private mapSeverityToSentryLevel(severity?: ErrorSeverity): Sentry.SeverityLevel {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return 'fatal';
      case ErrorSeverity.HIGH:
        return 'error';
      case ErrorSeverity.MEDIUM:
        return 'warning';
      case ErrorSeverity.LOW:
        return 'info';
      default:
        return 'error';
    }
  }

  // Update metrics
  private updateMetrics(error: Error, severity?: ErrorSeverity): void {
    this.metrics.totalErrors++;
    
    if (severity) {
      this.metrics.errorsBySeverity[severity]++;
    }

    const category = error.constructor.name;
    this.metrics.errorsByCategory[category] = (this.metrics.errorsByCategory[category] || 0) + 1;
  }

  // Get metrics
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  // Add custom alert configuration
  addAlertConfig(config: AlertConfig): void {
    this.alertConfigs.push(config);
  }

  // Remove alert configuration
  removeAlertConfig(channel: AlertChannel): void {
    this.alertConfigs = this.alertConfigs.filter(c => c.channel !== channel);
  }

  // Create transaction for performance monitoring
  startTransaction(name: string, op: string): any {
    return Sentry.startTransaction({ name, op });
  }

  // Add breadcrumb
  addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
    Sentry.addBreadcrumb(breadcrumb);
  }

  // Set user context
  setUser(user: Sentry.User | null): void {
    Sentry.setUser(user);
  }

  // Set custom context
  setContext(key: string, context: any): void {
    Sentry.setContext(key, context);
  }

  // Clear error metrics (for housekeeping)
  clearMetrics(): void {
    this.metrics = {
      totalErrors: 0,
      errorsBySeverity: {
        [ErrorSeverity.LOW]: 0,
        [ErrorSeverity.MEDIUM]: 0,
        [ErrorSeverity.HIGH]: 0,
        [ErrorSeverity.CRITICAL]: 0
      },
      errorsByCategory: {},
      alertsSent: 0
    };
  }
}

// Express middleware for error monitoring
export function errorMonitoringMiddleware() {
  return (req: any, res: any, next: any) => {
    // Add request context to Sentry
    Sentry.configureScope((scope) => {
      scope.setContext('request', {
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query
      });
      
      if (req.user) {
        scope.setUser({
          id: req.user.id,
          username: req.user.username
        });
      }
    });

    next();
  };
}