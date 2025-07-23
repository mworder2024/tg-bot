import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import * as winston from 'winston';

// Load environment variables
dotenv.config();

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ],
});

// Check required environment variables
const requiredEnvVars = ['BOT_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables:', missingEnvVars);
  logger.error('Please set these variables in Railway dashboard');
  process.exit(1);
}

// Simple health check endpoint for Railway
if (process.env.PORT) {
  const http = require('http');
  const server = http.createServer((req: any, res: any) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  server.listen(process.env.PORT, () => {
    logger.info(`Health check server listening on port ${process.env.PORT}`);
  });
}

async function startBot() {
  try {
    logger.info('Starting Telegram bot...');
    
    // Initialize bot with minimal config
    const bot = new Telegraf(process.env.BOT_TOKEN!);
    
    // Simple test command
    bot.command('start', (ctx) => {
      ctx.reply('Bot is running on Railway! 🚂');
    });
    
    bot.command('health', (ctx) => {
      ctx.reply('Bot is healthy and running! ✅');
    });
    
    // Error handling
    bot.catch((err: any, ctx: any) => {
      logger.error('Bot error:', err);
      ctx.reply('Sorry, an error occurred!');
    });
    
    // Launch bot
    await bot.launch();
    logger.info('Bot started successfully!');
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the bot
startBot().catch(err => {
  logger.error('Unhandled error:', err);
  process.exit(1);
});