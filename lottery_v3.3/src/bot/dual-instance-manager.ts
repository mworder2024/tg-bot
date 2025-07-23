import { QuizBot } from './quiz-bot.js';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface BotInstance {
  bot: QuizBot;
  mode: 'primary' | 'secondary';
  status: 'running' | 'stopped' | 'error';
  startTime?: Date;
  lastError?: string;
}

export class DualInstanceManager {
  private instances: Map<string, BotInstance> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  constructor() {
    logger.info('Dual instance manager initialized');
  }

  /**
   * Start both bot instances
   */
  async startBothInstances(): Promise<void> {
    try {
      // Start primary instance
      if (config.botInstance.primaryToken) {
        await this.startInstance('primary');
      } else {
        logger.warn('Primary bot token not configured');
      }

      // Start secondary instance if different token provided
      if (config.botInstance.secondaryToken && 
          config.botInstance.secondaryToken !== config.botInstance.primaryToken) {
        await this.startInstance('secondary');
      } else {
        logger.info('Secondary instance not configured or same as primary');
      }

      // Start health monitoring
      this.startHealthMonitoring();

      logger.info('Dual instance manager startup completed');
    } catch (error) {
      logger.error('Error starting dual instances:', error);
      throw error;
    }
  }

  /**
   * Start a specific instance
   */
  async startInstance(mode: 'primary' | 'secondary'): Promise<void> {
    try {
      logger.info(`Starting ${mode} instance...`);

      const bot = new QuizBot(mode);
      
      const instance: BotInstance = {
        bot,
        mode,
        status: 'stopped',
      };

      this.instances.set(mode, instance);

      // Start the bot
      await bot.start();
      
      instance.status = 'running';
      instance.startTime = new Date();
      
      logger.info(`✅ ${mode} instance started successfully`);
    } catch (error) {
      logger.error(`❌ Failed to start ${mode} instance:`, error);
      
      const instance = this.instances.get(mode);
      if (instance) {
        instance.status = 'error';
        instance.lastError = error.message;
      }
      
      throw error;
    }
  }

  /**
   * Stop a specific instance
   */
  stopInstance(mode: 'primary' | 'secondary'): void {
    const instance = this.instances.get(mode);
    if (!instance) {
      logger.warn(`No ${mode} instance found to stop`);
      return;
    }

    try {
      instance.bot.stop();
      instance.status = 'stopped';
      logger.info(`🛑 ${mode} instance stopped`);
    } catch (error) {
      logger.error(`Error stopping ${mode} instance:`, error);
      instance.status = 'error';
      instance.lastError = error.message;
    }
  }

  /**
   * Stop all instances
   */
  stopAllInstances(): void {
    logger.info('Stopping all bot instances...');
    
    for (const [mode] of this.instances) {
      this.stopInstance(mode as 'primary' | 'secondary');
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    logger.info('All instances stopped');
  }

  /**
   * Restart a specific instance
   */
  async restartInstance(mode: 'primary' | 'secondary'): Promise<void> {
    logger.info(`Restarting ${mode} instance...`);
    
    this.stopInstance(mode);
    
    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await this.startInstance(mode);
  }

  /**
   * Get instance status
   */
  getInstanceStatus(mode: 'primary' | 'secondary'): BotInstance | null {
    return this.instances.get(mode) || null;
  }

  /**
   * Get all instances status
   */
  getAllStatus(): { [key: string]: BotInstance } {
    const status: { [key: string]: BotInstance } = {};
    
    for (const [mode, instance] of this.instances) {
      status[mode] = {
        bot: instance.bot,
        mode: instance.mode,
        status: instance.status,
        startTime: instance.startTime,
        lastError: instance.lastError,
      };
    }
    
    return status;
  }

  /**
   * Start health monitoring for all instances
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Check every 30 seconds

    logger.info('Health monitoring started');
  }

  /**
   * Perform health check on all instances
   */
  private async performHealthCheck(): Promise<void> {
    for (const [mode, instance] of this.instances) {
      if (instance.status === 'running') {
        try {
          // Test bot connectivity by calling getMe
          await instance.bot.getBot().telegram.getMe();
          
          // Instance is healthy
          if (instance.status === 'error') {
            instance.status = 'running';
            instance.lastError = undefined;
            logger.info(`✅ ${mode} instance recovered`);
          }
        } catch (error) {
          logger.error(`❌ ${mode} instance health check failed:`, error);
          instance.status = 'error';
          instance.lastError = error.message;
          
          // Attempt automatic restart
          setTimeout(async () => {
            try {
              await this.restartInstance(mode as 'primary' | 'secondary');
              logger.info(`🔄 ${mode} instance automatically restarted`);
            } catch (restartError) {
              logger.error(`Failed to restart ${mode} instance:`, restartError);
            }
          }, 5000);
        }
      }
    }
  }

  /**
   * Get uptime for an instance
   */
  getInstanceUptime(mode: 'primary' | 'secondary'): number | null {
    const instance = this.instances.get(mode);
    if (!instance || !instance.startTime || instance.status !== 'running') {
      return null;
    }
    
    return Date.now() - instance.startTime.getTime();
  }

  /**
   * Get summary of all instances
   */
  getSummary(): {
    totalInstances: number;
    runningInstances: number;
    errorInstances: number;
    stoppedInstances: number;
    uptime: { [key: string]: number | null };
  } {
    const statuses = this.getAllStatus();
    const summary = {
      totalInstances: Object.keys(statuses).length,
      runningInstances: 0,
      errorInstances: 0,
      stoppedInstances: 0,
      uptime: {} as { [key: string]: number | null },
    };

    for (const [mode, instance] of Object.entries(statuses)) {
      switch (instance.status) {
        case 'running':
          summary.runningInstances++;
          break;
        case 'error':
          summary.errorInstances++;
          break;
        case 'stopped':
          summary.stoppedInstances++;
          break;
      }
      
      summary.uptime[mode] = this.getInstanceUptime(mode as 'primary' | 'secondary');
    }

    return summary;
  }

  /**
   * Load balancing: get the best available instance
   */
  getBestAvailableInstance(): BotInstance | null {
    // Prefer primary instance if running
    const primary = this.instances.get('primary');
    if (primary && primary.status === 'running') {
      return primary;
    }

    // Fall back to secondary instance
    const secondary = this.instances.get('secondary');
    if (secondary && secondary.status === 'running') {
      return secondary;
    }

    return null;
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful shutdown of dual instance manager...');
    
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Stop all instances
    this.stopAllInstances();

    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));

    logger.info('Graceful shutdown completed');
  }
}

// Global instance for the application
export const dualInstanceManager = new DualInstanceManager();

// Handle process termination
process.once('SIGINT', async () => {
  logger.info('Received SIGINT, starting graceful shutdown...');
  await dualInstanceManager.gracefulShutdown();
  process.exit(0);
});

process.once('SIGTERM', async () => {
  logger.info('Received SIGTERM, starting graceful shutdown...');
  await dualInstanceManager.gracefulShutdown();
  process.exit(0);
});