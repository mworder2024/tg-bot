# Deployment Guide

This guide covers deployment options for the Telegram Lottery Bot v3.4.

## Table of Contents
- [Railway Deployment](#railway-deployment)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

## Railway Deployment

### Prerequisites
- Railway CLI: `npm install -g @railway/cli`
- Railway account: https://railway.app

### Quick Start

1. **Login and Initialize**
   ```bash
   railway login
   railway init
   ```

2. **Set Required Variables**
   ```bash
   railway variables set BOT_TOKEN=your-telegram-bot-token
   railway variables set VRF_SECRET=0e4ba098221f48116c68d5c77fc8acc7b90d31a69b1636931b8f3183ee36d2fb
   ```

3. **Deploy**
   ```bash
   railway up
   ```

### Database & Redis (Optional)

The bot works without a database, but you can add persistence:

1. **Add PostgreSQL**: New Service → Database → PostgreSQL
2. **Add Redis**: New Service → Database → Redis

Railway automatically sets `DATABASE_URL` and `REDIS_URL`.

### Post-Deployment

#### Set Telegram Webhook (if using webhook mode)
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<your-railway-app>.railway.app/webhook"}'
```

### Monitoring

```bash
railway logs -f          # Follow logs
railway status          # Check deployment
railway open           # Open dashboard
railway variables      # List environment variables
```

## Local Development

### Setup
```bash
npm install
cp .env.example .env
# Edit .env with your configuration
```

### Running
```bash
# Development with hot reload
npm run dev

# Enhanced bot development
./scripts/run-enhanced-dev.sh

# Production build
npm run build
npm start
```

### Verification
```bash
# Verify bot configuration
./scripts/verify-bot.sh

# Test enhanced bot
./scripts/test-enhanced-bot.sh
```

## Environment Variables

### Required
- `BOT_TOKEN` - Telegram bot token (required)
- `VRF_SECRET` - For randomness generation (default provided)

### Optional - Core
- `DEFAULT_ADMIN_ID` - Your Telegram user ID
- `SUPER_ADMIN_ID` - For highest privileges
- `DEFAULT_CHAT_ID` - For scheduled games
- `LOG_LEVEL` - debug, info, warn, error (default: info)
- `ENVIRONMENT` - development or production

### Optional - Services
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `ANTHROPIC_API_KEY` - For AI features
- `SENTRY_DSN` - Error monitoring

### Optional - Solana/Blockchain
- `SOLANA_NETWORK` - devnet or mainnet-beta
- `SOLANA_RPC_URL` - Your Solana RPC endpoint
- `SOLANA_PROGRAM_ID` - Your deployed program ID
- `BOT_WALLET_KEY` - Bot's wallet private key

### Finding Your Telegram User ID
Message @userinfobot on Telegram to get your user ID.

### What Works Without Database/Redis
✅ Basic lottery games
✅ Player management
✅ Drawing system
✅ Winner selection
✅ Admin commands
✅ Game scheduling

### What Requires Database/Redis
❌ Persistent stats/leaderboard
❌ Long-term game history
❌ Cross-session data

## Troubleshooting

### Bot Not Responding
1. Check logs: `railway logs` or local console
2. Verify `BOT_TOKEN` is correct
3. Ensure bot has proper Telegram permissions
4. Check bot started successfully (look for "Bot started" in logs)

### Missing Environment Variables
```bash
# Railway
railway variables set BOT_TOKEN=your-token

# Local
echo "BOT_TOKEN=your-token" >> .env
```

### Database Connection Issues
- Bot works without database for basic games
- Verify `DATABASE_URL` is set if using PostgreSQL
- Check PostgreSQL service is running
- Review connection logs

### Memory Issues (Railway)
- Railway free tier: 512MB RAM
- Disable unused features to save memory:
  ```bash
  railway variables set ENABLE_BLOCKCHAIN=false
  railway variables set ENABLE_QUIZ_MODE=false
  ```
- Upgrade plan for more resources

### Build Failures
- Ensure all dependencies are in `package.json`
- Test build locally first: `npm run build`
- Check TypeScript errors: `npm run typecheck`

### Emergency Fixes

If bot keeps crashing on Railway:

1. **Use minimal bot**:
   ```bash
   railway variables set START_MINIMAL=true
   ```

2. **Disable all features**:
   ```bash
   railway variables set DISABLE_ALL_FEATURES=true
   ```

3. **Increase timeouts**:
   ```bash
   railway variables set BOT_TIMEOUT=120000
   railway variables set HANDLER_TIMEOUT=90000
   ```

### Gradual Feature Enablement

After basic bot is running:

1. **Add PostgreSQL**: Railway dashboard → New Service
2. **Add Redis**: Railway dashboard → New Service
3. **Enable features one by one**:
   ```bash
   railway variables set ENABLE_WEB_DASHBOARD=true
   railway variables set ENABLE_BLOCKCHAIN=true
   ```

## Alternative Deployment Options

### Replit
1. Go to https://replit.com
2. Create new Repl → Import from GitHub
3. Set environment variables in Secrets
4. Click Run

### Glitch
1. Go to https://glitch.com
2. New Project → Import from GitHub
3. Add `.env` file with your bot token
4. Project automatically deploys

### Heroku (Paid)
```bash
heroku create your-bot-name
git push heroku main
```

## Support

- Railway Discord: https://discord.gg/railway
- Railway Support: support@railway.app
- Project Issues: Check GitHub repository
- Logs: Always check logs first for error details