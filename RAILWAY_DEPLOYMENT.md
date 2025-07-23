# Railway Deployment Guide

## Prerequisites
- Railway CLI installed: `npm install -g @railway/cli`
- Railway account: https://railway.app

## Deployment Steps

### 1. Login and Initialize
```bash
railway login
railway init
```

### 2. Deploy
```bash
railway up
```

### 3. Configure Environment Variables
Go to your Railway dashboard and add these environment variables:

#### Required Variables:
- `BOT_TOKEN` - Your Telegram bot token
- `ENVIRONMENT` - Set to "production"
- `DATABASE_URL` - PostgreSQL connection string (Railway can provide this)
- `REDIS_URL` - Redis connection string (Railway can provide this)
- `JWT_SECRET` - Random secure string
- `SOLANA_NETWORK` - "devnet" or "mainnet-beta"
- `SOLANA_RPC_URL` - Your Solana RPC endpoint
- `LOG_LEVEL` - "info"

#### Optional Variables (based on features you use):
- `ANTHROPIC_API_KEY` - If using AI features
- `SENTRY_DSN` - If using error monitoring
- `VRF_SECRET` - For VRF functionality
- `SOLANA_PROGRAM_ID` - Your deployed program ID
- `BOT_WALLET_KEY` - Bot's wallet private key

### 4. Add Database (PostgreSQL)
In Railway dashboard:
1. Go to your project
2. Click "New Service" → "Database" → "PostgreSQL"
3. Railway will automatically set `DATABASE_URL`

### 5. Add Redis
In Railway dashboard:
1. Click "New Service" → "Database" → "Redis"
2. Railway will automatically set `REDIS_URL`

### 6. Monitor Deployment
- Check logs: `railway logs`
- View dashboard: `railway open`

## Post-Deployment

### Set Telegram Webhook (if using webhook mode)
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<your-railway-app>.railway.app/webhook"}'
```

### Test Bot
1. Message your bot on Telegram
2. Check Railway logs for activity
3. Monitor error rates in dashboard

## Useful Railway Commands
```bash
railway logs                 # View logs
railway open                # Open project dashboard
railway status              # Check deployment status
railway variables           # List environment variables
railway variables set KEY=value  # Set environment variable
```

## Troubleshooting

### Bot Not Responding
1. Check Railway logs: `railway logs`
2. Verify `BOT_TOKEN` is correct
3. Check bot is running: Look for "Bot started" in logs

### Database Connection Issues
1. Verify `DATABASE_URL` is set
2. Check PostgreSQL service is running
3. Review connection logs

### Memory/Performance Issues
- Railway provides 512MB RAM by default
- Upgrade plan if needed
- Monitor resource usage in dashboard