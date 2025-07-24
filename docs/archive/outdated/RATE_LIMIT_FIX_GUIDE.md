# Rate Limit Fix Implementation Guide

## Problem Analysis

The bot was experiencing a cascade failure when rate limited:
1. Bot sends many messages during game (joins, countdowns, draws)
2. Telegram returns 429 (rate limit) errors
3. Bot tries to recover by retrying immediately
4. This triggers more rate limits
5. Scheduled timers continue firing, trying to send more messages
6. Bot gets stuck in perpetual rate limit loop
7. Games can't start properly due to message failures

## The Complete Fix

### 1. Safe Telegram API (`src/utils/safe-telegram-api.ts`)

**Key Features:**
- Global rate limit detection (pauses all sending after 3 consecutive errors)
- Per-chat rate limit tracking
- No immediate retries - messages are queued instead
- Minimum delays between messages (100ms normal, 5s critical)
- Automatic cleanup of blocked chats
- Game-aware (tracks active games to prevent orphaned timers)

### 2. Safe Notification Manager (`src/utils/safe-notification-manager.ts`)

**Key Features:**
- Buffers join announcements (10 second windows)
- Prevents duplicate countdown messages
- Priority-based message sending
- Skips non-critical messages when rate limited
- Cleans up when games finish

### 3. Fixed Bot Implementation (`src/index-fixed.ts`)

**Key Changes:**
- All timers are tracked and can be cancelled
- Rate limit checks before starting games
- Progressive delays between draw announcements
- Graceful degradation when rate limited
- Clean shutdown of active games

## Implementation Steps

### Step 1: Backup Current Bot
```bash
# Create backup
cp src/index.ts src/index.ts.backup-$(date +%Y%m%d)
cp -r src/utils src/utils-backup-$(date +%Y%m%d)
```

### Step 2: Install New Files
```bash
# Copy the new utility files
cp src/utils/safe-telegram-api.ts src/utils/
cp src/utils/safe-notification-manager.ts src/utils/
```

### Step 3: Test with Fixed Version
```bash
# Compile TypeScript
npm run build

# Test with the fixed version first
node dist/index-fixed.js

# Monitor for rate limits
# In another terminal, watch the logs
tail -f bot.log | grep -i "rate"
```

### Step 4: Monitor Performance

Use the new commands:
- `/ratelimit` - Check current status
- `/clearratelimit` - Emergency reset (use sparingly)

Watch for:
- "globally rate limited" messages
- Pending message counts
- Active game tracking

### Step 5: Gradual Migration

1. **Test in a single group first**
2. **Monitor for 24 hours**
3. **Check that games start properly**
4. **Verify no message spam**
5. **Then deploy to all groups**

### Step 6: Replace Main Bot
```bash
# Once confirmed working
cp src/index-fixed.ts src/index.ts
npm run build
npm start
```

## Configuration Tuning

In `safe-telegram-api.ts`, adjust these if needed:

```typescript
// Global pause after X consecutive rate limits
GLOBAL_RATE_LIMIT_THRESHOLD = 3  

// How long to pause when globally rate limited
RATE_LIMIT_COOLDOWN = 60000  // 1 minute

// Maximum messages to queue
MAX_PENDING_MESSAGES = 100

// Delay between critical messages (game starts, winners)
CRITICAL_MESSAGE_DELAY = 5000  // 5 seconds
```

## Monitoring

### Log Patterns to Watch

**Good:**
```
[INFO] Rate limited for chat 123456. Retry after 30s
[INFO] Globally rate limited, queueing message
[INFO] Processing 3 pending messages
```

**Bad:**
```
[ERROR] Rate limited for chat 123456 (multiple times in succession)
[WARN] Large message queue detected: 50+ messages
[ERROR] Circuit breaker opened
```

### Metrics to Track

1. **Queue Size**: Should stay under 20 normally
2. **Rate Limited Chats**: Should clear within minutes
3. **Global Rate Limit**: Should be rare (< 1/hour)
4. **Game Start Success**: Should be 100%

## Troubleshooting

### Games Won't Start
- Check `/ratelimit` status
- Look for "globally rate limited" in logs
- Use `/clearratelimit` if necessary
- Wait 60 seconds and try again

### Messages Delayed
- This is normal and intentional
- Non-critical messages wait when rate limited
- Critical messages (winners) get priority

### Bot Seems Slow
- Check pending message count
- May need to increase delays if hitting limits
- Consider reducing countdown notifications

## Benefits of This Fix

1. **No More Spam Loops**: Messages are queued, not retried immediately
2. **Games Always Complete**: Critical messages get through
3. **Graceful Degradation**: Bot slows down instead of failing
4. **Automatic Recovery**: Clears rate limits after cooldown
5. **Better User Experience**: No message floods in groups

## Testing the Fix

Run this test to verify:

```javascript
// In a test group:
// 1. Create a game
// 2. Have 10+ people join rapidly  
// 3. Watch /ratelimit status
// 4. Verify game starts properly
// 5. Check no message spam occurs
```

## Rollback Plan

If issues occur:
```bash
# Restore backup
cp src/index.ts.backup-[date] src/index.ts
cp -r src/utils-backup-[date]/* src/utils/
npm run build
npm start
```

## Long-term Improvements

Consider these for the future:
1. Use webhooks instead of polling
2. Implement message batching
3. Add Redis for distributed rate limiting
4. Create separate bot instances for different groups
5. Use Telegram's Bot API 6.0+ features for better rate limits