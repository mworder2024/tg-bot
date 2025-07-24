# Admin Menu Guide

## Overview

The enhanced bot includes a comprehensive admin menu system that allows administrators to configure all aspects of the bot without editing code or restarting.

## Accessing the Admin Menu

Use the `/admin` command to open the main admin panel. Only users configured as admins can access this menu.

```
/admin
```

## Menu Structure

### 📅 Schedule Management

Manage recurring game schedules for automatic game creation.

**Features:**
- View current schedule status
- Create new schedules with custom intervals
- Pause/resume active schedules
- Cancel schedules

**Creating a Schedule:**
```
/schedule 4h 3              # Every 4 hours, 3 survivors
/schedule 30m 1 --max 20    # Every 30 minutes, max 20 players
/schedule 2h 5 --start 10   # Every 2 hours, 10 minute start delay
```

**Schedule Commands:**
- `/schedule` - View current schedule
- `/schedule pause` - Pause active schedule
- `/schedule resume` - Resume paused schedule
- `/schedule cancel` - Cancel schedule

### ⚡ Game Speed Configuration

Control the pace of games with three preset modes and customizable settings.

**Speed Modes:**
- **🚀 Fast Mode**: Quick games with shorter delays
  - Early game: 4 numbers/3s delays
  - Bubble phase: 15s delays
  
- **⚖️ Normal Mode**: Balanced gameplay
  - Early game: 3 numbers/6s delays
  - Bubble phase: 25s delays
  
- **🐌 Slow Mode**: Extended games for suspense
  - Early game: 2 numbers/10s delays
  - Bubble phase: 35s delays

**Suspense Messages:**
Toggle special messages during the final eliminations to build excitement.

### 👥 Group Management

View and manage all groups where the bot is active.

**Features:**
- List all registered groups
- View group status (enabled/disabled)
- See group IDs and admin assignments

### 🎮 Game Settings

Configure default parameters for all games.

**Configurable Options:**
- **Max Players**: Default maximum players per game
- **Start Delay**: Minutes before game starts
- **Number Range**: Multiplier for number selection (e.g., 2x = twice as many numbers as players)
- **Min Players**: Minimum players required to start

**Message Settings:**
- **Join Buffer**: Enable/disable join message bundling
- **Buffer Window**: Time window for bundling joins
- **Countdowns**: Show/hide countdown notifications

### 📊 Statistics

Access various bot statistics and metrics.

**Categories:**
- **Game Stats**: Total games, average duration, completion rates
- **Player Stats**: Active players, win rates, participation
- **Prize Stats**: Total distributed, average prizes
- **Performance**: Message rates, response times

### 🔧 System

System management and maintenance options.

**Features:**
- View system information (uptime, memory usage)
- Access logs
- Clear cache
- Backup configuration

## Configuration Persistence

All settings are saved to `data/game-config.json` and persist across bot restarts.

### Exporting Configuration

1. Navigate to Game Settings
2. Select "Export Config"
3. Bot will send the current configuration as JSON

### Importing Configuration

1. Navigate to Game Settings
2. Select "Import Config"
3. Send the JSON configuration to import

## Speed Configuration Details

### Game Phases

Each speed mode defines behavior for different game phases:

1. **Early Game** (>20 players)
   - Multiple numbers per draw
   - Fastest pace
   - No player lists

2. **Mid Game** (10-20 players)
   - Fewer numbers per draw
   - Moderate pace
   - No player lists

3. **Late Game** (<10 players)
   - Single number draws
   - Slower pace
   - Show remaining players

4. **Final Game** (<5 players)
   - Single number draws
   - Very slow pace
   - Show player lists

5. **Bubble Phase** (1-3 to eliminate)
   - Maximum suspense
   - Countdown sequences
   - Special messages

## Best Practices

### Schedule Configuration

1. **Active Groups**: Use 2-4 hour intervals
2. **Testing**: Use 15-30 minute intervals
3. **Start Delay**: 5-10 minutes recommended
4. **Survivors**: Scale with max players (10% rule)

### Speed Settings

1. **Large Groups**: Use Fast mode for 50+ player games
2. **Small Groups**: Use Normal or Slow for <20 players
3. **Special Events**: Enable suspense for tournaments
4. **Testing**: Disable suspense for quick tests

### Message Management

1. **High Activity**: Enable join buffering
2. **Rate Limits**: Increase buffer window
3. **Quiet Groups**: Can disable buffering
4. **Countdowns**: Disable for very frequent games

## Troubleshooting

### Menu Not Responding

1. Check admin permissions
2. Verify bot is running
3. Try `/admin` command again

### Settings Not Saving

1. Check `data/` directory permissions
2. Verify disk space
3. Check logs for write errors

### Schedule Not Running

1. Verify schedule is enabled
2. Check no active game blocking
3. Review schedule parameters
4. Check system time

## Advanced Features

### Custom Speed Profiles

While the UI provides three presets, the configuration file supports full customization:

```json
{
  "speedSettings": {
    "custom": {
      "earlyGame": { "delay": 5000, "numbersPerDraw": 3, "threshold": 20 },
      "midGame": { "delay": 7000, "numbersPerDraw": 2, "threshold": 10 },
      "lateGame": { "delay": 10000, "numbersPerDraw": 1, "threshold": 5 },
      "finalGame": { "delay": 15000, "numbersPerDraw": 1, "threshold": 3 },
      "bubble": { "delay": 20000, "threshold": 1 }
    }
  }
}
```

### Webhook Integration

The admin menu can be extended to support webhook notifications:
- Game start/end events
- Schedule triggers
- Error notifications

## Security Considerations

1. **Admin Access**: Only trusted users should have admin privileges
2. **Configuration Backup**: Regular backups recommended
3. **Import Validation**: Imported configs are validated
4. **Rate Limiting**: Admin commands are not rate limited

## Future Enhancements

Planned features for the admin menu:
- Player management (bans, warnings)
- Custom message templates
- Analytics dashboard
- Automated backups
- Multi-language support