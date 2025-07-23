# Enhanced Bot Features Documentation

## Overview

The enhanced lottery bot includes advanced features to prevent rate limiting, improve game dynamics, and add scheduling capabilities.

## Key Features

### 1. Advanced Message Queue Management

**Purpose**: Prevent rate limiting by intelligently managing all outgoing messages.

**Features**:
- All messages go through a central queue before sending
- Automatic bundling of join messages (3-second window)
- Priority-based message sending (critical > high > normal > low)
- Minimum 300ms delay between messages
- Automatic retry on rate limit with exponential backoff
- Only latest announcement kept in queue (prevents spam)

**Implementation**:
```typescript
// Messages are automatically queued
messageQueue.enqueue({
  type: 'join',      // or 'announcement', 'game', 'draw', 'suspense'
  chatId: chatId,
  content: message,
  priority: 'normal',
  userId: userId,    // For join bundling
  username: username
});
```

### 2. Zero Response to Late Joins

**Behavior**:
- Once game starts (`state !== 'WAITING'`), `/join` commands are completely ignored
- No error messages sent to group
- Prevents spam during active games
- Personal confirmations still sent when successfully joining

### 3. Dynamic Game Speed

**Speed Configurations**:

| Players Remaining | Draw Delay | Numbers/Draw | Show Players | Suspense |
|------------------|------------|--------------|--------------|----------|
| >20 | 6 seconds | 3 | No | No |
| 10-20 | 8 seconds | 2 | No | No |
| <10 | 12 seconds | 1 | Yes | No |
| <5 | 18 seconds | 1 | Yes | No |
| 3 to eliminate | 20 seconds | 1 | Yes | Yes |
| 1 to eliminate | 25 seconds | 1 | Yes | Yes + Countdown |

**Features**:
- Faster elimination in early game (3 numbers at once)
- Gradual slowdown as players decrease
- Maximum suspense for final eliminations
- Dynamic adjustment based on elimination rate

### 4. Suspense Building

**Bubble Messages** (when 1-3 players left to eliminate):
- 24 unique suspense messages
- Randomly selected to maintain variety
- Build tension as players approach the cutoff

**Final Draw Sequence** (last elimination):
- Special announcement message
- Countdown sequence (3... 2... 1...)
- 10 different countdown styles
- Maximum delay for anticipation

**Prize Updates**:
- Shows current prize per survivor
- Calculates how many need to be eliminated
- Updates at key thresholds
- Emphasizes proximity to winning

### 5. Game Scheduling

**Admin Command**: `/schedule`

**Usage Examples**:
```
/schedule 4h 3              - Every 4 hours, 3 survivors
/schedule 30m 1 --max 20    - Every 30 min, 1 survivor, max 20 players
/schedule 2h 5 --start 10   - Every 2 hours, 5 survivors, 10 min start delay
/schedule                   - View current schedule
/schedule pause             - Pause schedule
/schedule resume            - Resume schedule
/schedule cancel            - Cancel schedule
```

**Features**:
- Automatic game creation at specified intervals
- Configurable survivors, max players, and start delay
- Skips creation if game already active
- Persists across bot restarts
- Shows next game time and schedule status

**Supported Intervals**:
- Minutes: `15m`, `30min`, `45minutes`
- Hours: `1h`, `2hr`, `4hours`, `6.5h`
- Range: 5 minutes to 24 hours

### 6. Message Bundling Examples

**Before** (10 players joining):
```
Player1 joined!
Player2 joined!
Player3 joined!
... (10 separate messages)
```

**After** (bundled):
```
👥 Player1, Player2, Player3, Player4 and Player5 joined! (5/50)
[3 seconds later]
👥 Player6, Player7, Player8, Player9 and Player10 joined! (10/50)
```

### 7. Performance Improvements

**Message Reduction**:
- 80%+ reduction in join messages
- 95%+ reduction in error responses
- No duplicate announcements
- Efficient multi-number draws

**Rate Limit Prevention**:
- Proactive queuing (not reactive)
- Intelligent message bundling
- Priority-based sending
- Automatic backoff on errors

**Game Reliability**:
- Absolute time-based starts
- Survives bot restarts
- Handles rate limits gracefully
- No manual intervention needed

## Configuration

### Environment Variables
```env
BOT_TOKEN=your_bot_token
DEFAULT_ADMIN_ID=admin_user_id
DEFAULT_CHAT_ID=default_chat_id
MAX_PLAYERS=50
LOG_LEVEL=info
```

### Adjustable Parameters

**Message Queue** (`message-queue-manager.ts`):
```typescript
PROCESS_INTERVAL = 500;        // Queue processing frequency
JOIN_BUNDLE_WINDOW = 3000;     // Join bundling window
MIN_MESSAGE_DELAY = 300;       // Minimum delay between messages
```

**Game Speed** (`game-speed-manager.ts`):
```typescript
// Adjust delays in getSpeedConfig() method
// Modify numbersPerDraw for different player counts
// Change suspense message thresholds
```

**Scheduler** (`game-scheduler.ts`):
```typescript
// Minimum interval: 5 minutes
// Maximum interval: 24 hours (1440 minutes)
// Validation rules in validateSchedule()
```

## Admin Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/forcestart` | Start game immediately | `/forcestart` |
| `/schedule` | Manage scheduled games | `/schedule 2h 3` |
| `/addgroup` | Enable bot in group | `/addgroup` |
| `/stats` | View game statistics | `/stats` |

## Monitoring

### Log Patterns
```bash
# Monitor message queue
grep "queue" bot.log | tail -20

# Check bundling effectiveness
grep "Bundling join" bot.log | wc -l

# Track game speed changes
grep "Game speed config" bot.log

# Monitor scheduled games
grep "scheduled game" bot.log
```

### Key Metrics
- **Queue Size**: Should stay under 10 normally
- **Bundle Efficiency**: 3-5 players per message
- **Game Completion**: 100% without intervention
- **Schedule Reliability**: Games start within 30s of scheduled time

## Troubleshooting

### Games Not Starting on Schedule
1. Check schedule status: `/schedule`
2. Verify no active game blocking
3. Check logs for "scheduled game" entries
4. Ensure bot has proper permissions

### Messages Seem Slow
1. This is intentional to prevent rate limits
2. Critical messages (winners) get priority
3. Check queue size in `/status`
4. Adjust MIN_MESSAGE_DELAY if needed

### Suspense Messages Not Appearing
1. Only show when 1-3 eliminations remain
2. Check game survivor settings
3. Verify speed config thresholds
4. Monitor "suspense" in logs

## Best Practices

1. **Scheduling**:
   - Use longer intervals (2-4 hours) for active groups
   - Shorter intervals (30m-1h) for testing
   - Adjust start delay based on group activity

2. **Game Configuration**:
   - Keep survivor count reasonable (10% of max players)
   - Use default 5-minute start delay
   - Let auto-calculation handle survivors

3. **Monitoring**:
   - Watch queue size during peak times
   - Monitor completion rates
   - Track user engagement with faster early game

4. **Maintenance**:
   - Clear old logs periodically
   - Monitor memory usage with many schedules
   - Test schedule persistence across restarts