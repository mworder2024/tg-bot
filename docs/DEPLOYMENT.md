# Deployment Guide

This guide covers deployment of the Telegram Lottery Bot v3.4 to Railway.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Railway Deployment](#railway-deployment)
- [Environment Variables](#environment-variables)
- [Post-Deployment Setup](#post-deployment-setup)
- [Local Development](#local-development)
- [Monitoring & Logs](#monitoring--logs)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required
- [Railway Account](https://railway.app) (free tier available)
- [Telegram Bot Token](https://t.me/botfather) from BotFather
- Node.js 18+ (for local development)

### Optional
- Railway CLI: `npm install -g @railway/cli`
- Redis instance (for persistence)
- PostgreSQL database (for advanced features)

## Railway Deployment

### Method 1: Deploy from GitHub (Recommended)

1. **Fork or push your code to GitHub**

2. **Create new Railway project**
   - Go to [Railway Dashboard](https://railway.app/dashboard)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Configure environment variables** (see [Environment Variables](#environment-variables))

4. **Deploy**
   - Railway automatically deploys on push to main branch

### Method 2: Deploy via CLI

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login and initialize**
   ```bash
   railway login
   railway link  # Select existing project or create new
   ```

3. **Set environment variables**
   ```bash
   railway variables set BOT_TOKEN=your-telegram-bot-token
   railway variables set VRF_SECRET=your-vrf-secret
   ```

4. **Deploy**
   ```bash
   railway up
   ```

### Method 3: Direct Deploy Button

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/lottery-bot)

Click the button and follow the prompts to deploy directly.

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `BOT_TOKEN` | Telegram Bot API token | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `VRF_SECRET` | Secret for random number generation | Any 64-character hex string |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port (for webhook mode) | `3000` |
| `WEBHOOK_URL` | Public URL for webhook mode | - |
| `REDIS_URL` | Redis connection URL | - |
| `DATABASE_URL` | PostgreSQL connection URL | - |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `ADMIN_IDS` | Comma-separated admin user IDs | - |
| `DEFAULT_CHAT_ID` | Default group chat ID | - |
| `ENABLE_PERSISTENCE` | Enable game state persistence | `true` |

### Setting Variables in Railway

1. Go to your project dashboard
2. Click on your service
3. Navigate to "Variables" tab
4. Add each variable:
   - Click "New Variable"
   - Enter name and value
   - Click "Add"

Or use Raw Editor to paste all at once:
```env
BOT_TOKEN=your-telegram-bot-token
VRF_SECRET=0e4ba098221f48116c68d5c77fc8acc7b90d31a69b1636931b8f3183ee36d2fb
NODE_ENV=production
LOG_LEVEL=info
```

## Post-Deployment Setup

### 1. Webhook Configuration (Optional)

For better performance, configure webhook mode:

```bash
# Get your Railway app URL
WEBHOOK_URL=$(railway status --json | jq -r .url)

# Set webhook
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$WEBHOOK_URL/webhook\"}"
```

### 2. Add Bot to Groups

1. Add bot to your Telegram groups
2. Make bot an administrator (required for managing games)
3. Use `/start` to initialize the bot in each group

### 3. Configure Admins

Set admin user IDs in environment variables:
```bash
railway variables set ADMIN_IDS=123456789,987654321
```

## Local Development

### Setup

1. **Clone repository**
   ```bash
   git clone <your-repo-url>
   cd telegram-lottery-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create `.env` file**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

4. **Run locally**
   ```bash
   npm run dev
   ```

### Testing with ngrok

For webhook testing locally:
```bash
# Install ngrok
npm install -g ngrok

# Start ngrok
ngrok http 3000

# Use ngrok URL as WEBHOOK_URL
```

## Monitoring & Logs

### Railway Logs

View logs in Railway dashboard:
1. Go to your project
2. Click on the service
3. Navigate to "Logs" tab

Or via CLI:
```bash
railway logs --tail
```

### Health Checks

The bot includes built-in health monitoring:
- Automatic restart on crashes
- Memory usage tracking
- Error logging with timestamps

### Metrics

Monitor key metrics:
- Active games count
- Message queue size
- Response times
- Error rates

## Troubleshooting

### Bot Not Responding

1. **Check logs for errors**
   ```bash
   railway logs --tail 100
   ```

2. **Verify environment variables**
   ```bash
   railway variables
   ```

3. **Test bot token**
   ```bash
   curl https://api.telegram.org/bot$BOT_TOKEN/getMe
   ```

### Deployment Failures

1. **Check build logs**
   - Look for npm install errors
   - Verify Node.js version compatibility

2. **Environment issues**
   - Ensure all required variables are set
   - Check for typos in variable names

3. **Resource limits**
   - Free tier: 500 hours/month
   - Check usage in Railway dashboard

### Performance Issues

1. **Enable Redis** for better performance:
   - Add Redis service in Railway
   - It auto-configures `REDIS_URL`

2. **Optimize message sending**:
   - Bot includes rate limiting protection
   - Adjust `MESSAGE_DELAY_MS` if needed

3. **Scale horizontally**:
   - Railway supports multiple instances
   - Enable via dashboard scaling options

### Common Issues

**"Webhook not working"**
- Ensure `WEBHOOK_URL` is publicly accessible
- Check SSL certificate validity
- Verify webhook is set correctly

**"Bot kicked from group"**
- Ensure bot has admin privileges
- Check for Telegram API rate limits
- Review group permissions

**"Games not persisting"**
- Add Redis or PostgreSQL service
- Check `ENABLE_PERSISTENCE` is `true`
- Verify database connections

## Support

- [Railway Documentation](https://docs.railway.app)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- Project Issues: [GitHub Issues](https://github.com/your-repo/issues)