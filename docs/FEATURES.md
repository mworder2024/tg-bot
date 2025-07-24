# Bot Features

## Overview

The Telegram Lottery Bot v3.4 is a survival lottery game where players select numbers and try to be the last one standing. The bot includes advanced features for rate limit prevention, dynamic game mechanics, and scheduling capabilities.

## Core Game Mechanics

### 🎲 Survival Lottery System

- **Objective**: Be the LAST player standing
- **Win Condition**: All other players eliminated
- **Strategy**: Choose numbers less likely to be drawn

### 📊 Dynamic Number Range

- **Formula**: Number range = 2× player count
- **Examples**: 
  - 5 players → 1-10 range
  - 10 players → 1-20 range
  - 15 players → 1-30 range
- **Selection Method**: Players receive DM from bot to privately select their number

### 🎯 Draw System

- **VRF Integration**: Uses Verifiable Random Function for fair draws
- **Progressive Elimination**: Numbers are drawn until one player remains
- **No Repeats**: Each number can only be drawn once per game

## Advanced Features

### 1. Message Queue Management

**Purpose**: Prevent Telegram rate limiting by intelligently managing all outgoing messages.

**Key Features**:
- Central message queue with priority handling
- Automatic bundling of join messages (3-second window)
- Priority levels: critical > high > normal > low
- Minimum 300ms delay between messages
- Automatic retry with exponential backoff
- Latest announcement replacement (prevents spam)

**Message Types**:
- `join` - Player join notifications (bundled)
- `announcement` - Game announcements (replaceable)
- `game` - Game state updates
- `draw` - Number draw results
- `suspense` - Dramatic countdown messages

### 2. Dynamic Game Speed

The game automatically adjusts speed based on remaining players:

| Players Remaining | Draw Delay | Numbers/Draw | Show Players | Suspense Mode |
|-------------------|------------|--------------|--------------|---------------|
| >20 | 6 seconds | 3 | No | No |
| 10-20 | 8 seconds | 2 | No | No |
| <10 | 12 seconds | 1 | Yes | No |
| ≤5 | 15 seconds | 1 | Yes | Yes |

**Suspense Mode Features** (≤5 players):
- Dramatic countdown sequences
- Random bubble messages
- Player position updates
- Prize pool updates
- Extended final countdowns

### 3. Game Scheduling

**Automated Game Creation**:
- Schedule games at specific times
- Recurring games (hourly, daily, weekly)
- Custom intervals (e.g., every 45 minutes)
- Timezone support
- Automatic announcements

**Schedule Examples**:
```
/schedule 14:30 daily      # Daily at 2:30 PM
/schedule 20:00 weekly     # Weekly at 8:00 PM
/schedule 45m interval     # Every 45 minutes
```

### 4. Anti-Spam Features

**Late Join Prevention**:
- `/join` commands ignored after game starts
- No error messages sent to group
- Prevents chat spam during active games

**Message Deduplication**:
- Only latest announcement kept in queue
- Prevents duplicate countdown messages
- Smart bundling of similar messages

### 5. Persistence & Recovery

**Game State Persistence**:
- All games saved to `data/games.json`
- Automatic recovery after bot restart
- Scheduled games resume automatically
- Player selections preserved

**Leaderboard Tracking**:
- Win/loss statistics
- Total games played
- Win rate percentages
- Cross-group statistics

## Game Flow

### 1. Game Creation
```
🎰 NEW SURVIVAL LOTTERY! 🎰
Game ID: XXXXXX

💰 Prize Pool: [amount]
🎯 Survival Mode: Last player standing wins!
⏱️ Registration: 60 seconds

Type /join to play!
```

### 2. Player Registration
```
✅ PlayerName joined! (X players)
```
*Multiple joins bundled into single message*

### 3. Number Selection Phase
```
🚨 GAME STARTING! 🚨

🎲 Survival Lottery XXXXXX
👥 Players: [count]
🔢 Number Range: 1-[2×players]
⏱️ Selection Time: 60 seconds

📱 Check your DMs from @BotName to select your number!
```

### 4. Draw Phase
```
📊 NUMBER SELECTIONS REVEALED!

🎲 Survival Lottery XXXXXX
🔢 Range: 1-[max]

🔹 Player1: 3
🔹 Player2: 7
[...]

🎯 DRAWING BEGINS IN 5 SECONDS...
```

### 5. Progressive Elimination
```
🎲 DRAW #X

Drawing [1-3] numbers...
🔮 Numbers drawn: X, Y, Z

💥 ELIMINATED:
❌ PlayerName (chose X)

✅ SURVIVORS: X players remaining
```

### 6. Winner Announcement
```
🏆 WINNER! 🏆

🎉 PlayerName is the SOLE SURVIVOR!
💰 Prize: [amount]
🎯 Winning number: X

Congratulations! 🎊
```

## Administrative Features

### Group Management
- Multi-group support
- Per-group configurations
- Admin-only commands
- Scheduled game management

### Game Configuration
- Custom number ranges
- Prize pool settings
- Timer adjustments
- Speed profile selection

### Monitoring
- Real-time game statistics
- Message queue monitoring
- Rate limit tracking
- Error logging

## Technical Features

### Rate Limiting Protection
- Intelligent message queuing
- Exponential backoff on errors
- Circuit breaker pattern
- Per-chat rate tracking

### Error Recovery
- Automatic reconnection
- Game state recovery
- Scheduled task resumption
- Graceful degradation

### Performance Optimization
- Message bundling
- Queue prioritization
- Efficient timer management
- Memory usage optimization

## User Commands

### Player Commands
- `/join` - Join the current game
- `/stats` - View your statistics
- `/leaderboard` - View top players
- `/help` - Show help message

### Admin Commands
- `/admin` - Open admin menu
- `/schedule` - Manage scheduled games
- `/config` - Game configuration
- `/announce` - Send announcements

## Integration Features

### Telegram Integration
- Inline keyboards for number selection
- Private message support
- Group management
- User mention support

### Data Export
- Game history export
- Statistics export
- Leaderboard export
- Configuration backup

## Security Features

- Admin-only command protection
- Rate limit circumvention prevention
- Anti-spam measures
- Secure random number generation