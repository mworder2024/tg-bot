import { UnifiedBot } from './bot/unified-bot.js';
import config from './config/index.js';
import { logger } from './utils/logger.js';
import * as dotenv from 'dotenv';
import * as dns from 'dns';

// Load environment variables
dotenv.config();

// Force IPv4 DNS resolution
dns.setDefaultResultOrder('ipv4first');

/**
 * Main entry point for the Unified Bot application
 * Supports both Quiz and Lottery modes with dual instance capability
 */
async function main() {
  try {
    // Validate configuration
    logger.info('🔍 Validating configuration...');

    if (!config.bot.token && !config.botInstance.primaryToken) {
      logger.error('BOT_TOKEN or PRIMARY_BOT_TOKEN is required');
      process.exit(1);
    }

    if (config.features.anthropicIntegration && !config.anthropic.apiKey) {
      logger.warn('Anthropic integration enabled but no API key provided - AI features will be disabled');
    }

    logger.info('🚀 Starting Unified Bot (Quiz + Lottery)...');
    logger.info(`📊 Configuration Summary:`);
    logger.info(`   • Environment: ${config.bot.environment}`);
    logger.info(`   • Instance Mode: ${config.botInstance.mode}`);
    logger.info(`   • Quiz Mode: ${config.features.quizMode ? '✅' : '❌'}`);
    logger.info(`   • Lottery Mode: ${config.features.paidGames ? '✅' : '❌'}`);
    logger.info(`   • Anthropic AI: ${config.features.anthropicIntegration ? '✅' : '❌'}`);
    logger.info(`   • Blockchain: ${config.features.blockchain ? '✅' : '❌'}`);
    logger.info(`   • Web Dashboard: ${config.features.webDashboard ? '✅' : '❌'}`);

    // Create and start unified bot
    const unifiedBot = new UnifiedBot(config.botInstance.mode as 'primary' | 'secondary');
    await unifiedBot.start();

    logger.info('🎯 Unified Bot startup completed!');

    console.log('\n🎯 Unified Bot is ready!');
    console.log('🧠 AI-powered quiz questions with Anthropic Claude');
    console.log('🎲 VRF-based lottery games');
    console.log('👥 User registration and analytics');
    console.log('📊 Advanced statistics and leaderboards');
    console.log('🔄 Dual instance support for high availability');
    
    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('📡 Shutting down unified bot...');
      unifiedBot.stop();
      logger.info('✅ Unified bot shutdown completed');
      process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

  } catch (error) {
    logger.error('❌ Failed to start Unified Bot:', error);
    console.error('💥 Startup failed. Check logs for details.');
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('🔄 Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

// Startup banner
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   🎯 UNIFIED BOT v2.0                       ║
║                                                              ║
║  🧠 AI Quiz Mode - Powered by Anthropic Claude              ║
║  🎲 Lottery Mode - VRF-based Survival Games                 ║
║  👥 User Management - Registration & Analytics              ║
║  📊 Advanced Stats - Leaderboards & Progress Tracking      ║
║  🔄 Dual Instance - High Availability Support               ║
║                                                              ║
║  The ultimate Telegram bot for knowledge & entertainment!   ║
╚══════════════════════════════════════════════════════════════╝
`);

// Start the application
main().catch((error) => {
  logger.error('💥 Fatal error in main:', error);
  process.exit(1);
});