import { dashboardAPI } from './api-server';
import { logger } from '../utils/logger';
import { metricsCollector } from '../monitoring/prometheus-metrics';

export async function startDashboard(): Promise<void> {
  try {
    logger.info('Starting Lottery Bot Dashboard...');
    
    // Start the dashboard API server
    await dashboardAPI.start();
    
    logger.info('Dashboard API server started successfully');
    const port = Number(process.env.DASHBOARD_PORT) || 3001;
    logger.info(`Dashboard available at: http://localhost:${port}`);
    logger.info(`Prometheus metrics at: http://localhost:${port}/metrics`);
    
    // Log dashboard configuration
    logger.info('Dashboard Features:');
    logger.info('- Real-time game monitoring via WebSocket');
    logger.info('- Admin controls for game management');
    logger.info('- Prometheus metrics integration');
    logger.info('- System performance monitoring');
    logger.info('- Game analytics and statistics');
    
  } catch (error) {
    logger.error('Failed to start dashboard:', error);
    throw error;
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down dashboard gracefully...');
  try {
    await dashboardAPI.stop();
    logger.info('Dashboard stopped successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during dashboard shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down dashboard gracefully...');
  try {
    await dashboardAPI.stop();
    logger.info('Dashboard stopped successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during dashboard shutdown:', error);
    process.exit(1);
  }
});

// Start dashboard if this file is run directly
if (require.main === module) {
  startDashboard().catch((error) => {
    logger.error('Failed to start dashboard:', error);
    process.exit(1);
  });
}