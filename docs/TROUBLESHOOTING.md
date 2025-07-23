# 🔧 Telegram Bot Troubleshooting Guide

## Network Connection Issues

If you're experiencing `ETIMEDOUT` errors when starting the bot, try these solutions:

### 1. Check Internet Connection
```bash
# Test basic connectivity
ping -c 3 google.com
curl -I https://google.com

# Test Telegram API specifically  
ping -c 3 api.telegram.org
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"
```

### 2. Network Environment Issues

**If you're in a restricted network environment:**
- University/corporate networks may block Telegram
- Some countries have Telegram restrictions
- Firewall may be blocking outbound HTTPS on port 443

### 3. Use Webhook Mode (Alternative)

If polling doesn't work, try webhook mode:

```typescript
// webhook-bot.ts
import { Telegraf } from 'telegraf';
import express from 'express';

const bot = new Telegraf(process.env.BOT_TOKEN!);
const app = express();

app.use(bot.webhookCallback('/webhook'));

bot.command('start', (ctx) => {
  ctx.reply('🎲 Lottery Bot is running via webhook!');
});

// Set webhook
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || `https://yourdomain.com/webhook`;

bot.telegram.setWebhook(WEBHOOK_URL);
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
```

### 4. Use ngrok for Local Testing

```bash
# Install ngrok
npm install -g ngrok

# Start webhook server
npm run webhook

# In another terminal, expose it
ngrok http 3000

# Set webhook URL in bot
```

### 5. Alternative: Use Bot via Proxy

```typescript
import { Telegraf } from 'telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyAgent = new HttpsProxyAgent('http://proxy:port');

const bot = new Telegraf(process.env.BOT_TOKEN!, {
  telegram: {
    agent: proxyAgent
  }
});
```

### 6. Use Telegram Bot API Server (Self-hosted)

For complete control, you can run your own Bot API server:

```bash
# Download official Bot API server
# https://core.telegram.org/bots/api#using-a-local-bot-api-server
```

## Quick Fixes to Try

### Fix 1: Increase Timeouts
```typescript
const bot = new Telegraf(token, {
  handlerTimeout: 120000, // 2 minutes
  telegram: {
    apiRoot: 'https://api.telegram.org',
    agent: new https.Agent({
      timeout: 60000,
      keepAlive: true
    })
  }
});
```

### Fix 2: Use Different API Endpoint
```typescript
// Try different Telegram data centers
const bot = new Telegraf(token, {
  telegram: {
    apiRoot: 'https://api.telegram.org' // or try other DCs
  }
});
```

### Fix 3: Retry Logic with Exponential Backoff
```typescript
async function startBotWithRetry() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await bot.launch();
      console.log('✅ Bot started successfully!');
      return;
    } catch (error) {
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Failed to start bot after 5 attempts');
}
```

## Alternative Testing Methods

### Test Bot Without Telegraf

```javascript
// simple-test.js
const https = require('https');

function sendMessage(chatId, text) {
  const postData = JSON.stringify({
    chat_id: chatId,
    text: text
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${process.env.BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (d) => {
      console.log(d.toString());
    });
  });

  req.on('error', (e) => {
    console.error(e);
  });

  req.write(postData);
  req.end();
}

// Test with your chat ID
sendMessage('YOUR_CHAT_ID', 'Test message from raw HTTPS');
```

## Getting Your Chat ID

1. Message your bot on Telegram
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Look for your chat ID in the response

## If All Else Fails

1. **Deploy to a VPS/Cloud:** Services like Heroku, Railway, or DigitalOcean
2. **Use Telegram Bot hosting:** Services like BotFather hosting
3. **Wait and retry:** Sometimes it's temporary network congestion

## Contact Support

If none of these solutions work, the issue might be:
- Regional network restrictions
- ISP blocking Telegram
- Temporary Telegram API issues
- Local firewall configuration

Try deploying to a cloud service for immediate testing.