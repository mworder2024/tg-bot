# Lottery Scheduling Guide

## How to Schedule a Lottery 12 Hours From Now with 100,000 Tokens

### ✅ NEW SOLUTION: Use /scheduleevent Command!

You can now schedule one-time event lotteries with custom prizes:

```
/scheduleevent 12h 100000 "Mega Weekend Event"
```

This will schedule a lottery to run exactly 12 hours from now with a 100,000 token prize pool!

### Examples of Event Scheduling

**Time-based scheduling:**
- `/scheduleevent 30m 50000 "Quick Event"` - In 30 minutes
- `/scheduleevent 6h 75000 "Evening Special"` - In 6 hours
- `/scheduleevent 12h 100000 "Half Day Event"` - In 12 hours
- `/scheduleevent 1d 200000 "Tomorrow's Big Game"` - In 24 hours
- `/scheduleevent 2d12h 500000 "Weekend Mega Event"` - In 2.5 days

**Specific time scheduling:**
- `/scheduleevent 20:00 100000 "Prime Time"` - Today at 8:00 PM
- `/scheduleevent 15:30 50000 "Afternoon Game"` - Today at 3:30 PM
- `/scheduleevent 9:00am 75000 "Morning Special"` - Today at 9:00 AM

### Additional Options

You can customize your scheduled event further:
- `--max 100` - Set maximum players (default: 50)
- `--survivors 5` - Set number of winners (default: auto-calculated)
- `--start 10` - Set start delay in minutes when event begins (default: 5)

**Full example:**
```
/scheduleevent 12h 100000 "Mega Weekend" --max 75 --survivors 3 --start 15
```

### Managing Scheduled Events

- **View events:** `/scheduled` - Shows all upcoming events and recurring games
- **Cancel event:** `/cancelevent <eventId>` - Cancel a scheduled event (ID shown in /scheduled)

## Enhanced Help System

The bot now features an extensive help system with detailed command documentation:

### General Help Topics
- `/help` - Main help menu
- `/help --create` - Creating games & special events
- `/help --join` - How to join games
- `/help --stats` - Player statistics guide
- `/help --leaderboard` - Rankings information
- `/help --scheduled` - Viewing scheduled games
- `/help --mynumber` - Checking your lottery number

### Admin Help Topics
- `/help --schedule` - Complete scheduling guide
- `/help --activegames` - Monitor all active games
- `/help --endgame` - Force ending games
- `/help --forcestart` - Skip waiting periods

### Schedule Command Examples

**Basic Scheduling:**
- `/schedule 30m 1` - Every 30 minutes, 1 survivor
- `/schedule 4h 3` - Every 4 hours, 3 survivors
- `/schedule 12h 5` - Every 12 hours, 5 survivors

**Advanced Options:**
- `/schedule 2h 2 --max 50` - Every 2 hours, max 50 players
- `/schedule 6h 3 --start 15` - Every 6 hours, 15 min warning
- `/schedule 1h 1 --max 20 --start 10` - Hourly, 20 players max, 10 min start

**Schedule Management:**
- `/schedule` - View current schedule
- `/schedule pause` - Pause scheduled games
- `/schedule resume` - Resume scheduled games
- `/schedule cancel` - Cancel all scheduling

## Key Limitations

1. **Start Delay:** Maximum 30 minutes for `/create` command
2. **Custom Prizes:** Only available with `/create --event`, not with `/schedule`
3. **Schedule Interval:** Minimum 5 minutes, maximum 24 hours
4. **One Schedule:** Only one schedule per chat allowed

## Tips for Large Events

For events requiring long delays or custom prizes:
1. Use calendar reminders or bot scheduling services
2. Create the event manually when the time comes
3. Consider using the admin panel for better control
4. Announce the event in advance to build anticipation