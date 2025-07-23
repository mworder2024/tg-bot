# 🚀 Deployment Guide

Since you're experiencing network connectivity issues locally, here are several ways to deploy your bot:

## 1. Railway (Recommended - Free Tier)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway deploy

# Set environment variable
railway variables set BOT_TOKEN=7820572708:AAHX9TD2wfFzwDufOFaIzVzfPG7x5TUDqHM
```

## 2. Heroku

```bash
# Install Heroku CLI
# Create Procfile
echo "worker: npm start" > Procfile

# Deploy
heroku create lottery-bot-unique-name
heroku config:set BOT_TOKEN=7820572708:AAHX9TD2wfFzwDufOFaIzVzfPG7x5TUDqHM
git add . && git commit -m "Deploy lottery bot"
git push heroku main
```

## 3. DigitalOcean App Platform

1. Fork this repository to GitHub
2. Connect to DigitalOcean App Platform
3. Set BOT_TOKEN environment variable
4. Deploy automatically

## 4. Replit (Easiest)

1. Go to replit.com
2. Create new Node.js repl
3. Upload your files
4. Set BOT_TOKEN in Secrets tab
5. Click Run

## 5. Local Alternative - Use ngrok + Webhooks

If you want to run locally, use webhooks instead of polling:

```bash
# Install ngrok
npm install -g ngrok

# Create webhook version
cat > webhook-bot.js << 'EOF'
const { Telegraf } = require('telegraf');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

app.use(bot.webhookCallback('/webhook'));

// Your bot commands here (copy from main bot)
bot.command('start', (ctx) => {
  ctx.reply('🎲 Welcome to the Survival Lottery Bot!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Webhook server running on port \${PORT}\`);
});
EOF

# Start webhook server
node webhook-bot.js &

# In another terminal, expose with ngrok
ngrok http 3000

# Set webhook (use the HTTPS URL from ngrok)
curl -X POST "https://api.telegram.org/bot7820572708:AAHX9TD2wfFzwDufOFaIzVzfPG7x5TUDqHM/setWebhook" \
  -d "url=https://YOUR_NGROK_URL.ngrok.io/webhook"
```

## Quick Deploy Commands

### Railway (1-minute deploy):
```bash
npm install -g @railway/cli
railway login
railway init
railway variables set BOT_TOKEN=7820572708:AAHX9TD2wfFzwDufOFaIzVzfPG7x5TUDqHM
railway deploy
```

### Replit (No CLI needed):
1. Visit replit.com
2. Create new Node.js repl
3. Upload telegram-lottery-bot folder
4. Add BOT_TOKEN to Secrets
5. Click Run button

## Environment Variables Needed

```
BOT_TOKEN=7820572708:AAHX9TD2wfFzwDufOFaIzVzfPG7x5TUDqHM
NODE_ENV=production
MAX_PLAYERS=10
DEFAULT_SURVIVOR_COUNT=3
```

Your bot is fully ready - it just needs to run in an environment with unrestricted internet access!