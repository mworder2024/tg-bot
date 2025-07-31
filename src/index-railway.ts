#!/usr/bin/env node

// Railway-specific entry point
console.log('🚂 Starting bot in Railway environment...');
console.log('🔍 Environment check:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- ENVIRONMENT:', process.env.ENVIRONMENT || 'not set');
console.log('- BOT_TOKEN exists:', !!process.env.BOT_TOKEN);
console.log('- BOT_TOKEN length:', process.env.BOT_TOKEN?.length || 0);
console.log('- REDIS_URL exists:', !!process.env.REDIS_URL);
console.log('- PORT:', process.env.PORT || 'not set');

// Check required environment variables
const requiredEnvVars = ['BOT_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ CRITICAL ERROR: Missing required environment variables:', missingEnvVars);
  console.error('Please set these variables in Railway environment variables:');
  console.error('- BOT_TOKEN: Your Telegram bot token from @BotFather');
  process.exit(1);
}

// Set production environment if not specified
if (!process.env.ENVIRONMENT) {
  process.env.ENVIRONMENT = 'production';
  console.log('⚠️ ENVIRONMENT not set, defaulting to production');
}

// Set NODE_ENV for proper configuration
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

console.log('✅ Environment validated, starting full bot...');

// Import and start the main bot
// This will use the main index.js with all features
import('./index.js').catch(err => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});