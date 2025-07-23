# Required Environment Variables for Railway

## Minimal Required Variables (Bot will start with these)
```bash
# Telegram Bot Token (REQUIRED)
railway variables --set BOT_TOKEN=your-telegram-bot-token

# VRF Secret for randomness (REQUIRED) 
railway variables --set VRF_SECRET=0e4ba098221f48116c68d5c77fc8acc7b90d31a69b1636931b8f3183ee36d2fb

# Default Admin ID (OPTIONAL but recommended)
railway variables --set DEFAULT_ADMIN_ID=your-telegram-user-id
```

## Additional Variables (Add as needed)

### Admin Configuration
```bash
# Super Admin ID (for highest privileges)
railway variables --set SUPER_ADMIN_ID=your-telegram-user-id

# Default Chat ID (for scheduled games)
railway variables --set DEFAULT_CHAT_ID=your-group-chat-id
```

### Logging
```bash
# Log level (debug, info, warn, error)
railway variables --set LOG_LEVEL=info
```

### Redis (Optional - bot works without it)
```bash
# If you add Redis service in Railway
# Railway will auto-set REDIS_URL
```

### Database (Optional - bot works without it)
```bash
# If you add PostgreSQL service in Railway
# Railway will auto-set DATABASE_URL
```

## Finding Your Telegram User ID

1. Message @userinfobot on Telegram
2. It will reply with your user ID
3. Use this ID for DEFAULT_ADMIN_ID and SUPER_ADMIN_ID

## Minimal Deployment Commands

```bash
# Set only required variables
railway variables --set BOT_TOKEN=your-bot-token
railway variables --set VRF_SECRET=0e4ba098221f48116c68d5c77fc8acc7b90d31a69b1636931b8f3183ee36d2fb

# Deploy
railway up
```

## What Works Without Database/Redis

✅ Basic lottery games
✅ Player management
✅ Drawing system
✅ Winner selection
✅ Admin commands
✅ Game scheduling

## What Requires Database/Redis

❌ Persistent stats/leaderboard
❌ Long-term game history
❌ Cross-session data

The bot will work fine for running lottery games without a database - it just won't persist data between restarts.