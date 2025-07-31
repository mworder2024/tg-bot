#!/usr/bin/env node

console.log('=== ENVIRONMENT DEBUG ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('ENVIRONMENT:', process.env.ENVIRONMENT);
console.log('BOT_TOKEN exists:', !!process.env.BOT_TOKEN);
console.log('BOT_TOKEN length:', process.env.BOT_TOKEN?.length || 0);
console.log('BOT_TOKEN starts with:', process.env.BOT_TOKEN?.substring(0, 10) + '...');
console.log('BOT_TOKEN_DEV exists:', !!process.env.BOT_TOKEN_DEV);
console.log('All env vars starting with BOT:', Object.keys(process.env).filter(k => k.startsWith('BOT')));
console.log('========================');

// Try to load config
try {
  const config = require('./config').default;
  console.log('Config loaded successfully');
  console.log('Config bot token exists:', !!config.bot.token);
  console.log('Config environment:', config.bot.environment);
} catch (error: any) {
  console.error('Failed to load config:', error.message);
  console.error('Missing vars:', error.missingEnvVars);
}