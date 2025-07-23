# Scheduled Game Announcements

## Overview

The enhanced bot now includes comprehensive announcement system for scheduled games that provides regular updates every 5 minutes, building excitement and encouraging participation.

## Announcement Schedule

For scheduled games, the bot will send announcements at these intervals:

### Regular Updates (Every 5 minutes)
- Shows time remaining until game start
- Displays current player count with progress bar
- Lists players (if 10 or fewer)
- Shows spots remaining

### Final Countdown
- **2 minutes**: FINAL CALL warning
- **1 minute**: Last chance to join

## Announcement Features

### Initial Announcement
When a scheduled game is created:
```
🎰 **SCHEDULED LOTTERY ANNOUNCED!** 🎰

🎲 Game ID: `ABC123`
🤖 Auto-created by scheduler
⏰ **Starts at 15:30** (in 30 minutes)

📊 **Game Settings:**
• 👥 Max Players: **50**
• 🏆 Survivors: **3**
• 🔢 Number Range: **1-100**
• 💰 Prize Pool: **Grows with each player!**

✨ **Join early to secure your spot!**

💬 Use /join to participate!
```

### 5-Minute Updates
Regular reminders with dynamic content:
```
🎰 **Scheduled Game Reminder!**

🎲 Game ID: `ABC123`
⏰ **Starting in 25 minutes**
👥 Players: **12/50**
📊 Progress: [██░░░░░░░░]

✨ **38 spots remaining!**

**Current players:**
• Player1
• Player2
• ... (shows up to 10)

💬 Use /join to participate!
```

### Final Minutes
Urgent reminders with increased priority:
```
🎰 **Scheduled Game Reminder!**

🎲 Game ID: `ABC123`
⏰ **Starting in 2 minutes**
👥 Players: **45/50**
📊 Progress: [█████████░]

⚡ **FINAL CALL!** Game starts very soon!

✨ **5 spots remaining!**

💬 Use /join to participate!
```

## Configuration

The announcement system is automatic and requires no additional configuration. It adapts based on:

- **Game duration**: More announcements for longer wait times
- **Player count**: Shows player list only when manageable (<10)
- **Time remaining**: Increases urgency in final minutes
- **Available spots**: Highlights when game is nearly full

## Benefits

1. **Increased Participation**: Regular reminders catch attention
2. **Social Proof**: Showing current players encourages others
3. **Urgency**: Countdown creates FOMO (fear of missing out)
4. **Transparency**: Clear information about game settings
5. **Engagement**: Progress bars and player counts maintain interest

## Technical Details

- Announcements use the message queue system
- Priority increases for final countdown messages
- Usernames are properly escaped for Markdown
- Announcements stop if game is cancelled
- Progress bar provides visual feedback

## Example Schedule

For a game starting in 30 minutes:
- Initial announcement
- 25 minutes left (5-min mark)
- 20 minutes left
- 15 minutes left
- 10 minutes left
- 5 minutes left
- 2 minutes left (FINAL CALL)
- 1 minute left

This ensures players are well-informed and have multiple opportunities to join!