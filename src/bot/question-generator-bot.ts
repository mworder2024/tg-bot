import { questionGeneratorInstance } from '../services/question-generator-instance.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Question Generator Bot Entry Point
 * 
 * This is the main entry point for running the question generator as a standalone service.
 * It can be used to run a dedicated question generation instance that serves other bots.
 */

class QuestionGeneratorBot {
  private isRunning = false;

  constructor() {
    // Set up graceful shutdown handlers
    process.on('SIGINT', this.shutdown.bind(this));
    process.on('SIGTERM', this.shutdown.bind(this));
    process.on('SIGQUIT', this.shutdown.bind(this));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception in Question Generator Bot:', error);
      this.shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection in Question Generator Bot:', reason);
      this.shutdown();
    });
  }

  /**
   * Start the question generator bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Question Generator Bot is already running');
      return;
    }

    try {
      logger.info('Starting Question Generator Bot...');
      logger.info(`Environment: ${config.bot.environment}`);
      logger.info(`Anthropic Integration: ${config.features.anthropicIntegration ? 'Enabled' : 'Disabled'}`);

      // Initialize the question generator instance
      await questionGeneratorInstance.initialize();

      // Set up health monitoring
      this.setupHealthMonitoring();

      // Set up metrics reporting
      this.setupMetricsReporting();

      this.isRunning = true;
      logger.info('Question Generator Bot started successfully');

      // Keep the process alive
      this.keepAlive();

    } catch (error) {
      logger.error('Failed to start Question Generator Bot:', error);
      throw error;
    }
  }

  /**
   * Set up health monitoring
   */
  private setupHealthMonitoring(): void {
    // Monitor health every 60 seconds
    setInterval(async () => {
      try {
        const status = await questionGeneratorInstance.getStatus();
        const alerts = await questionGeneratorInstance.getActiveAlerts();
        
        if (status.status !== 'initialized') {
          logger.warn('Question Generator Instance not properly initialized');
          return;
        }

        // Check for critical alerts
        const criticalAlerts = alerts.filter(alert => alert.severity === 'critical');
        if (criticalAlerts.length > 0) {
          logger.error(`${criticalAlerts.length} critical alerts active:`, 
            criticalAlerts.map(a => a.message));
        }

        // Check service health
        const services = status.services;
        const generatorService = typeof services.generator === 'object' ? services.generator : { status: 'unknown' };
        const integrationService = typeof services.integration === 'object' ? services.integration : { status: 'unknown' };
        
        if (generatorService.status === 'unhealthy') {
          logger.error('Generator service is unhealthy:', generatorService);
        }

        if (integrationService.status === 'unhealthy') {
          logger.error('Integration service is unhealthy:', integrationService);
        }

        // Log healthy status periodically
        if (criticalAlerts.length === 0 && 
            generatorService.status === 'healthy' && 
            integrationService.status === 'healthy') {
          logger.debug('All services healthy', {
            pools: status.pools.length,
            queueLength: status.queue.pending + status.queue.processing,
            integrationStats: questionGeneratorInstance.getIntegrationStats()
          });
        }

      } catch (error) {
        logger.error('Error during health check:', error);
      }
    }, 60000);
  }

  /**
   * Set up metrics reporting
   */
  private setupMetricsReporting(): void {
    // Report detailed metrics every 5 minutes
    setInterval(async () => {
      try {
        const status = await questionGeneratorInstance.getStatus();
        const integrationStats = questionGeneratorInstance.getIntegrationStats();
        const metricsHistory = await questionGeneratorInstance.getMetricsHistory(1); // Last hour

        logger.info('Question Generator Metrics Report', {
          timestamp: new Date().toISOString(),
          pools: {
            total: status.pools.length,
            healthy: status.pools.filter(p => !p.isStale && p.currentSize >= p.targetSize * 0.8).length,
            stale: status.pools.filter(p => p.isStale).length,
            low: status.pools.filter(p => p.currentSize < p.targetSize * 0.5).length
          },
          queue: status.queue,
          integration: {
            totalRequests: integrationStats.totalRequests,
            successRate: integrationStats.successfulDeliveries / Math.max(integrationStats.totalRequests, 1),
            averageDeliveryTime: integrationStats.averageDeliveryTime,
            cacheHitRate: integrationStats.cacheHitRate
          },
          recentMetrics: metricsHistory.length > 0 ? {
            avgRequestsPerMinute: metricsHistory.reduce((sum, m) => sum + m.requestsPerMinute, 0) / metricsHistory.length,
            avgResponseTime: metricsHistory.reduce((sum, m) => sum + m.averageResponseTime, 0) / metricsHistory.length,
            avgSuccessRate: metricsHistory.reduce((sum, m) => sum + m.successRate, 0) / metricsHistory.length
          } : null
        });

        // Report top topics
        const topTopics = status.analytics
          .sort((a, b) => b.usageFrequency - a.usageFrequency)
          .slice(0, 5)
          .map(a => ({ topic: a.topic, difficulty: a.difficulty, usage: a.usageFrequency }));

        if (topTopics.length > 0) {
          logger.info('Top Question Topics', { topTopics });
        }

      } catch (error) {
        logger.error('Error generating metrics report:', error);
      }
    }, 5 * 60 * 1000);

    // Quick status every 30 seconds
    setInterval(async () => {
      try {
        const realtimeStats = await questionGeneratorInstance['monitorService'].getRealtimeStats();
        if (realtimeStats) {
          logger.debug('Realtime Stats', realtimeStats);
        }
      } catch (error) {
        // Ignore errors for debug logging
      }
    }, 30000);
  }

  /**
   * Keep the process alive
   */
  private keepAlive(): void {
    const keepAliveInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(keepAliveInterval);
        return;
      }
      
      // Heartbeat log
      logger.debug('Question Generator Bot heartbeat', {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      });
    }, 30000); // Every 30 seconds
  }

  /**
   * Shutdown the bot gracefully
   */
  private async shutdown(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Shutting down Question Generator Bot...');
    this.isRunning = false;

    try {
      // Shutdown the generator instance
      await questionGeneratorInstance.shutdown();
      
      logger.info('Question Generator Bot shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Get current status
   */
  isRunningStatus(): boolean {
    return this.isRunning;
  }
}

// Export for testing
export { QuestionGeneratorBot };

// Auto-start if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const bot = new QuestionGeneratorBot();
  
  bot.start().catch((error) => {
    logger.error('Failed to start Question Generator Bot:', error);
    process.exit(1);
  });
}

export default QuestionGeneratorBot;