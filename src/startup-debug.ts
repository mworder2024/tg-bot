#!/usr/bin/env node

console.log('🔍 STARTUP DEBUG - Environment Check');
console.log('====================================');
console.log('ENVIRONMENT:', process.env.ENVIRONMENT || 'NOT SET');
console.log('NODE_ENV:', process.env.NODE_ENV || 'NOT SET');
console.log('BOT_TOKEN exists:', process.env.BOT_TOKEN ? 'YES' : 'NO');
console.log('BOT_TOKEN_DEV exists:', process.env.BOT_TOKEN_DEV ? 'YES' : 'NO');

if (process.env.BOT_TOKEN) {
  console.log('BOT_TOKEN format: ' + process.env.BOT_TOKEN.substring(0, 10) + '...:' + process.env.BOT_TOKEN.slice(-10));
}

console.log('====================================');

// Now start the actual bot
require('./index');