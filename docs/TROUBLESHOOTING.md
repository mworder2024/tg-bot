# Troubleshooting Guide

## Table of Contents
- [Rate Limiting Issues](#rate-limiting-issues)
- [Network Connection Issues](#network-connection-issues)
- [Bot Not Responding](#bot-not-responding)
- [Game Issues](#game-issues)
- [Deployment Problems](#deployment-problems)
- [Performance Issues](#performance-issues)

## Rate Limiting Issues

### Problem: Bot Gets Rate Limited by Telegram

The bot can experience cascading rate limit failures when:
1. Sending many messages during game (joins, countdowns, draws)
2. Telegram returns 429 (Too Many Requests) errors
3. Bot retries immediately, triggering more rate limits
4. Scheduled timers continue firing, creating a perpetual loop

### Solution: Built-in Rate Limit Protection

The bot includes comprehensive rate limiting protection:

#### Safe Telegram API (`src/utils/safe-telegram-api.ts`)
- **Global rate limit detection** - Pauses all sending after 3 consecutive errors
- **Per-chat rate limit tracking** - Individual chat management
- **No immediate retries** - Messages are queued instead
- **Minimum delays** - 100ms normal, 5s for critical messages
- **Automatic cleanup** - Blocked chats are handled gracefully
- **Game-aware** - Tracks active games to prevent orphaned timers

#### Safe Notification Manager (`src/utils/safe-notification-manager.ts`)
- **Join announcement buffering** - 10-second windows
- **Duplicate prevention** - No repeat countdown messages
- **Priority-based sending** - Critical messages first
- **Skip non-critical** - When rate limited
- **Clean game finish** - Proper cleanup

#### Message Queue Manager Features
- **Exponential backoff**: 1s → 2s → 4s → ... → 5 minutes max
- **Circuit breaker**: Stops sending when too many errors
- **Message deduplication**: Prevents duplicate messages
- **Burst protection**: Limits messages per minute

### Configuration

Adjust rate limiting in environment variables:

```env
# Message delays (milliseconds)
MESSAGE_DELAY_MS=300          # Minimum delay between messages
RATE_LIMIT_WINDOW_MS=60000    # Rate limit window (1 minute)
MAX_MESSAGES_PER_MINUTE=20    # Maximum messages per minute

# Retry configuration
MAX_RETRY_ATTEMPTS=3          # Maximum retry attempts
INITIAL_RETRY_DELAY_MS=1000   # Initial retry delay
MAX_RETRY_DELAY_MS=300000     # Maximum retry delay (5 minutes)
```

### Manual Recovery

If bot is stuck in rate limit loop:

1. **Restart the bot**
   ```bash
   # Railway
   railway restart
   
   # Local
   npm run restart
   ```

2. **Clear message queue**
   - Bot automatically clears queue on restart
   - Old scheduled messages are discarded

3. **Reduce game speed**
   - Use admin menu to slow down draws
   - Increase delays between announcements

## Network Connection Issues

### ETIMEDOUT Errors

If experiencing timeout errors when starting the bot:

#### 1. Check Internet Connection
```bash
# Test basic connectivity
ping -c 3 google.com
curl -I https://google.com

# Test Telegram API specifically  
ping -c 3 api.telegram.org
curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"
```

#### 2. Network Restrictions
Common causes:
- University/corporate firewalls
- Country-specific Telegram blocks
- Port 443 (HTTPS) restrictions

#### 3. Use Alternative Connection Methods

**Webhook Mode** (if polling fails):
```typescript
// Enable webhook in environment
WEBHOOK_URL=https://your-domain.com/webhook
PORT=3000
```

**Proxy Support**:
```env
# HTTP proxy
HTTP_PROXY=http://proxy-server:port

# SOCKS proxy
SOCKS_PROXY=socks5://proxy-server:port
```

#### 4. Increase Timeouts
```env
# Connection timeouts
CONNECTION_TIMEOUT_MS=60000
HANDLER_TIMEOUT_MS=90000
```

## Bot Not Responding

### 1. Verify Bot Token
```bash
# Test token validity
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"
```

### 2. Check Bot Permissions
- Bot must be group admin
- Required permissions:
  - Send messages
  - Delete messages
  - Pin messages (optional)

### 3. Verify Environment Variables
```bash
# Railway
railway variables

# Local
cat .env | grep BOT_TOKEN
```

### 4. Check Logs
```bash
# Railway logs
railway logs --tail 100

# Local logs
tail -f bot.log
```

## Game Issues

### Game Won't Start
1. Check if another game is active
2. Verify bot has admin permissions
3. Check minimum player requirements
4. Review scheduled game conflicts

### Players Can't Join
1. Ensure game is in WAITING state
2. Check if player already joined
3. Verify group permissions
4. Check rate limiting status

### Number Selection Not Working
1. Verify bot can send DMs
2. Check player privacy settings
3. Ensure selection phase is active
4. Review callback query handling

### Draw Phase Stuck
1. Check for rate limiting
2. Verify VRF is working
3. Review timer management
4. Check for JavaScript errors

## Deployment Problems

### Railway Deployment Fails

#### Build Errors
```bash
# Check build logs
railway logs --build

# Common fixes:
# 1. Clear cache
railway cache clear

# 2. Update dependencies
npm update
npm audit fix

# 3. Check Node version
# Ensure package.json specifies:
"engines": {
  "node": ">=18.0.0"
}
```

#### Environment Variable Issues
- Variable names are case-sensitive
- No quotes around values in Railway
- Use Raw Editor for complex values

#### Resource Limits
- Free tier: 500 hours/month
- Memory limit: 512MB (free tier)
- Check usage in dashboard

### Local Development Issues

#### Port Already in Use
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

#### Module Not Found
```bash
# Clear node_modules
rm -rf node_modules package-lock.json
npm install

# Clear TypeScript cache
rm -rf dist
npm run build
```

## Performance Issues

### High Memory Usage
1. Enable Redis for caching
2. Reduce message history retention
3. Implement periodic cleanup
4. Monitor with `railway logs --metrics`

### Slow Response Times
1. Enable message queue optimization
2. Reduce animation delays
3. Use webhook instead of polling
4. Enable connection pooling

### Database Performance
1. Add indexes for frequent queries
2. Enable connection pooling
3. Use Redis for session storage
4. Implement query caching

## Common Error Messages

### "Forbidden: bot was blocked by the user"
- User blocked the bot
- Skip sending DMs to this user
- Clean up user data periodically

### "Bad Request: message to delete not found"
- Message already deleted
- Implement safe delete with try-catch
- Ignore 400 errors for deletes

### "Conflict: terminated by other getUpdates request"
- Multiple bot instances running
- Check for duplicate processes
- Use webhook mode to prevent

### "Too Many Requests: retry after X"
- Hit Telegram rate limit
- Bot will auto-retry with backoff
- Reduce message frequency

## Quick Fixes

### Reset Bot State
```bash
# Clear all game data
rm -rf data/games.json
rm -rf data/leaderboard.json

# Restart bot
npm run restart
```

### Emergency Stop
```bash
# Stop all games immediately
echo '{}' > data/games.json
railway restart
```

### Clear Redis Cache
```bash
# If using Redis
redis-cli FLUSHALL
```

## Getting Help

### Logs Location
- Railway: Dashboard → Logs tab
- Local: `bot.log` file
- System: `journalctl -u lottery-bot`

### Debug Mode
```env
# Enable debug logging
LOG_LEVEL=debug
DEBUG=telegraf:*
```

### Support Channels
- GitHub Issues: Report bugs
- Railway Dashboard: Deployment help
- Telegram @BotSupport: API issues