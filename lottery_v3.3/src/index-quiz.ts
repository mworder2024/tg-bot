import { dualInstanceManager } from './bot/dual-instance-manager.js';
import config from './config/index.js';
import { logger } from './utils/logger.js';
import * as dotenv from 'dotenv';
import * as dns from 'dns';

// Load environment variables
dotenv.config();

// Force IPv4 DNS resolution
dns.setDefaultResultOrder('ipv4first');

/**
 * Main entry point for the Quiz Bot application
 * Supports dual instance management for high availability
 */
async function main() {
  try {
    // Validate configuration
    if (!config.features.anthropicIntegration) {
      logger.warn('Anthropic integration is disabled - quiz functionality will be limited');
    }

    if (!config.features.quizMode) {
      logger.error('Quiz mode is disabled in configuration');
      process.exit(1);
    }

    if (!config.anthropic.apiKey && config.features.anthropicIntegration) {
      logger.error('ANTHROPIC_API_KEY is required when ENABLE_ANTHROPIC_INTEGRATION is true');
      process.exit(1);
    }

    logger.info('🚀 Starting Quiz Bot with dual instance support...');
    logger.info(`📊 Configuration:`);
    logger.info(`   • Environment: ${config.bot.environment}`);
    logger.info(`   • Instance Mode: ${config.botInstance.mode}`);
    logger.info(`   • Anthropic Integration: ${config.features.anthropicIntegration ? '✅' : '❌'}`);
    logger.info(`   • Quiz Mode: ${config.features.quizMode ? '✅' : '❌'}`);
    logger.info(`   • Rate Limits: ${config.anthropic.rateLimitPerMinute}/min, ${config.anthropic.rateLimitPerHour}/hour`);

    // Start both instances
    await dualInstanceManager.startBothInstances();

    // Log startup success
    const summary = dualInstanceManager.getSummary();
    logger.info('🎯 Quiz Bot startup completed!');
    logger.info(`📊 Instance Summary:`);
    logger.info(`   • Total Instances: ${summary.totalInstances}`);
    logger.info(`   • Running: ${summary.runningInstances}`);
    logger.info(`   • Stopped: ${summary.stoppedInstances}`);
    logger.info(`   • Errors: ${summary.errorInstances}`);

    // Log instance details
    const allStatus = dualInstanceManager.getAllStatus();
    for (const [mode, instance] of Object.entries(allStatus)) {
      const uptime = summary.uptime[mode];
      const uptimeStr = uptime ? `${Math.round(uptime / 1000)}s` : 'N/A';
      logger.info(`   • ${mode}: ${instance.status} (uptime: ${uptimeStr})`);
    }

    console.log('\n🎯 Quiz Bot is ready!');
    console.log('🧠 AI-powered question generation enabled');
    console.log('🔄 Dual instance management active');
    console.log('📚 Ready to create engaging quizzes!');

    // Set up periodic status logging
    setInterval(() => {
      const summary = dualInstanceManager.getSummary();
      if (summary.errorInstances > 0) {
        logger.warn(`⚠️ ${summary.errorInstances} instance(s) in error state`);
      }
    }, 300000); // Every 5 minutes

  } catch (error) {
    logger.error('❌ Failed to start Quiz Bot:', error);
    console.error('💥 Startup failed. Check logs for details.');
    
    // Attempt graceful cleanup
    try {
      await dualInstanceManager.gracefulShutdown();
    } catch (cleanupError) {
      logger.error('Error during cleanup:', cleanupError);
    }
    
    process.exit(1);
  }
}

// Handle process signals for graceful shutdown
process.once('SIGINT', async () => {
  logger.info('📡 Received SIGINT (Ctrl+C), shutting down gracefully...');
  try {
    await dualInstanceManager.gracefulShutdown();
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
});

process.once('SIGTERM', async () => {
  logger.info('📡 Received SIGTERM, shutting down gracefully...');
  try {
    await dualInstanceManager.gracefulShutdown();
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception:', error);
  
  // Attempt graceful shutdown
  dualInstanceManager.gracefulShutdown()
    .then(() => {
      logger.info('✅ Emergency shutdown completed');
      process.exit(1);
    })
    .catch((shutdownError) => {
      logger.error('❌ Emergency shutdown failed:', shutdownError);
      process.exit(1);
    });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('🔄 Unhandled Promise Rejection at:', promise, 'reason:', reason);
  
  // Don't exit immediately for promise rejections, just log them
  // The application should continue running unless it's a critical error
});

// Add startup banner
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                      🎯 QUIZ BOT v2.0                       ║
║                                                              ║
║  🧠 AI-Powered Question Generation with Anthropic Claude    ║
║  🔄 Dual Instance High Availability Support                 ║
║  📊 Advanced User Analytics & Leaderboards                  ║
║  🎚️ Multiple Difficulty Levels & Topics                     ║
║  ⚡ Real-time Quiz Sessions & Group Voting                  ║
║                                                              ║
║  Ready to test knowledge and engage users! 🚀               ║
╚══════════════════════════════════════════════════════════════╝
`);

// Start the application
main().catch((error) => {
  logger.error('💥 Fatal error in main:', error);
  process.exit(1);
});