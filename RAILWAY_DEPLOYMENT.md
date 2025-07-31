# Railway Deployment Guide

## Required Environment Variables

You MUST set these environment variables in Railway dashboard:

### Essential Variables
- `BOT_TOKEN` - Your Telegram bot token from @BotFather (REQUIRED)
- `REDIS_URL` - Redis connection URL (Railway provides this automatically if you add Redis service)
- `ENVIRONMENT` - Set to `production` (optional, defaults to production)

### Optional Variables
- `DEFAULT_CHAT_ID` - Default chat/group ID for the bot
- `DEFAULT_ADMIN_ID` - Your Telegram user ID for admin access
- `VRF_SECRET` - Secret for random number generation
- `DASHBOARD_ADMIN_TOKEN` - Admin token for dashboard access

## Deployment Steps

1. **Create a new project on Railway**
   - Go to https://railway.app
   - Create new project from GitHub

2. **Add Redis service**
   - Click "New Service" in Railway
   - Select "Redis"
   - Railway will automatically set `REDIS_URL`

3. **Configure environment variables**
   - Go to your bot service settings
   - Click on "Variables"
   - Add `BOT_TOKEN` with your bot token value
   - Add any other optional variables

4. **Deploy**
   - Railway will automatically deploy when you push to GitHub
   - Check logs to ensure bot starts successfully

## Troubleshooting

### Bot shows "401 Unauthorized"
- Verify `BOT_TOKEN` is set correctly in Railway variables
- Token should be in format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
- Do NOT include quotes around the token

### Redis connection fails
- Ensure Redis service is added to your Railway project
- Railway automatically injects `REDIS_URL` when Redis is added

### Bot doesn't respond to commands
- Check logs for any startup errors
- Verify bot is running: `/health` command should respond
- Ensure bot has proper permissions in your Telegram group

## Environment Variable Reference

```bash
# Required
BOT_TOKEN=your_bot_token_here

# Optional but recommended
REDIS_URL=redis://... (auto-set by Railway)
DEFAULT_ADMIN_ID=your_telegram_user_id
ENVIRONMENT=production

# Optional
DEFAULT_CHAT_ID=-1001234567890
VRF_SECRET=your_secret_key
DASHBOARD_ADMIN_TOKEN=secure_admin_token
```

## Monitoring

- Health check endpoint: `https://your-app.railway.app/health`
- Check Railway logs for bot activity
- Bot will auto-restart on crashes (max 10 retries)