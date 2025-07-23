# Telegram Bot Rate Limiting Solution

## Problem Summary

The bot was experiencing a perpetual loop of rate limiting errors when:
1. It gets overwhelmed by too many messages/high load
2. Telegram API returns 429 (Too Many Requests) errors
3. The bot tries to recover by resending messages
4. This causes more rate limiting, creating an endless spam cycle

## Solution Overview

We've implemented a comprehensive rate limiting solution with the following components:

### 1. **Rate Limit Manager** (`src/utils/rate-limit-manager.ts`)

A centralized manager that handles:
- **Exponential Backoff**: Automatically increases wait time between retries
- **Circuit Breaker**: Stops all sending when too many errors occur
- **Message Queue**: Buffers messages to send at a controlled rate
- **Deduplication**: Prevents sending duplicate messages within a time window
- **Burst Protection**: Limits messages per minute to avoid triggering rate limits

### 2. **Telegram API Wrapper** (`src/utils/telegram-api-wrapper.ts`)

A wrapper around Telegram's API that:
- Automatically catches rate limit errors
- Queues messages instead of failing
- Prioritizes messages (high, medium, low priority)
- Handles different error types appropriately

### 3. **Enhanced Notification Manager**

The existing notification manager now works with the rate limiter to:
- Buffer join announcements
- Avoid sending messages too close together
- Smart scheduling of countdown notifications

## Key Features

### Exponential Backoff
```
Initial wait: 1 second
Second attempt: 2 seconds
Third attempt: 4 seconds
...
Maximum wait: 5 minutes
```

### Circuit Breaker States
- **Closed**: Normal operation
- **Open**: All sending stopped after 5 consecutive rate limit errors
- **Half-Open**: Automatically tries to resume after 1 minute

### Message Priority Levels
1. **Priority 9 (High)**: Game announcements, winner declarations
2. **Priority 5 (Normal)**: Regular messages
3. **Priority 3 (Low)**: Status updates, join notifications

### Rate Limiting Configuration
- Messages per second: 1 (conservative to avoid limits)
- Burst limit: 20 messages per minute
- Queue processing interval: 1 second
- Maximum retries: 3 per message

## Usage

### For Administrators

**Check Rate Limit Status:**
```
/ratelimit
```
Shows:
- Queue size
- Circuit breaker status
- Number of rate-limited chats
- Messages sent in the last minute

**Clear Rate Limits (Emergency Only):**
```
/clearratelimit
```
Clears rate limits for the current chat. Use with caution!

### For Developers

**Send a Message with Rate Limiting:**
```typescript
// Normal priority
await telegramApi.sendMessage(chatId, "Hello!", options);

// High priority (game announcements)
await telegramApi.sendHighPriorityMessage(chatId, "Game starting!");

// Low priority (status updates)
await telegramApi.sendLowPriorityMessage(chatId, "Player joined");
```

**Check Rate Limit Status Programmatically:**
```typescript
const status = rateLimitManager.getStatus();
console.log(`Queue size: ${status.queueSize}`);
console.log(`Circuit breaker: ${status.circuitBreakerOpen ? 'OPEN' : 'CLOSED'}`);
```

## How It Prevents Spam

1. **Immediate Queueing**: When rate limited, messages go to a queue instead of retrying immediately
2. **Controlled Processing**: Queue processes at most 1 message per second
3. **Deduplication**: Same message won't be sent twice within 5 seconds
4. **Circuit Breaker**: Stops everything if too many errors occur
5. **Smart Backoff**: Wait times increase exponentially, preventing rapid retries

## Monitoring

The bot logs important rate limit events:
- When rate limits are hit
- When circuit breaker opens/closes
- Queue size warnings (when > 50 messages)
- Failed message attempts

## Recovery Behavior

When the bot encounters rate limits:
1. Message is queued with appropriate priority
2. Bot waits for the specified retry_after time (or calculated backoff)
3. Circuit breaker opens if too many errors occur
4. After cooldown, bot slowly resumes sending
5. Successfully sent messages reset the backoff level

## Best Practices

1. **Use Priority Levels**: Mark game-critical messages as high priority
2. **Batch Announcements**: Use the notification buffer for multiple joins
3. **Monitor Queue Size**: Check /ratelimit regularly during high activity
4. **Avoid Rapid Messages**: Space out automated messages when possible
5. **Handle Errors Gracefully**: Don't retry on permanent errors (blocked, chat not found)

## Testing

To test the rate limiting:
1. Create a game with many players joining rapidly
2. Monitor with `/ratelimit` command
3. Watch for queue growth and circuit breaker activation
4. Verify messages are eventually delivered without spam

## Configuration

Key parameters (in `rate-limit-manager.ts`):
```typescript
MAX_RETRIES = 3              // Retry attempts per message
BASE_BACKOFF = 1000          // Initial backoff (1 second)
MAX_BACKOFF = 300000         // Maximum backoff (5 minutes)
MESSAGES_PER_SECOND = 1      // Conservative rate
BURST_LIMIT = 20             // Max messages per minute
CIRCUIT_BREAKER_THRESHOLD = 5 // Errors before circuit opens
```

Adjust these values based on your bot's usage patterns and Telegram's current limits.