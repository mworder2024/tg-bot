# Raid Feature Implementation Plan

## Overview
The --raid flag enables a special mode where the lottery pauses halfway through and requires engagement with a raid from @memeworldraidbot.

## Implementation Details

### 1. Raid Trigger Logic
- When game reaches 50% eliminations, pause the drawing
- Send engagement banter message
- Start monitoring for raid bot messages

### 2. Raid Bot Messages to Monitor
- **Success Message Format:**
  ```
  🎊 Raid Ended - Targets Reached!
  🟩 Likes X | X [X%]
  🟩 Retweets X | X [X%]
  ...
  🔥 Trending...
  ```

- **Failure Message Format:**
  ```
  ⚠️ Raid Ended - Time limit reached!
  🟥 Likes X | X [X%]
  🟥 Retweets X | X [X%]
  ...
  ```

### 3. Engagement Messages
During raid pause, send periodic messages (every 30-60 seconds):
- "🚨 RAID IN PROGRESS! Everyone engage or the lottery won't continue!"
- "💪 Keep pushing! We need more engagement to resume the game!"
- "🔥 Almost there! Don't stop now or we'll have to cancel!"
- "⚠️ Engagement dropping! Get in there or no prizes!"

### 4. Implementation Steps
1. Add raid pause check in performDraw function
2. Create raid monitoring function to watch for bot messages
3. Add engagement message timer during raid
4. Resume game on successful raid completion
5. Add more aggressive messages on raid failure

### 5. Code Structure
```typescript
// In performDraw function
if (currentGame.raidEnabled && !currentGame.raidPaused) {
  const eliminated = totalPlayers - activePlayers.size;
  const halfwayPoint = Math.floor(totalPlayers / 2);
  
  if (eliminated >= halfwayPoint) {
    pauseForRaid(chatId, currentGame);
    return;
  }
}

// New functions needed:
- pauseForRaid(chatId, game)
- monitorRaidBot(chatId, game) 
- sendEngagementReminder(chatId, game)
- resumeAfterRaid(chatId, game)
```

### 6. Message Examples
- Initial: "🚨 RAID TIME! Game paused until raid targets are hit!"
- Reminder: "👀 Still waiting for raid completion... GET IN THERE!"
- Success: "✅ RAID SUCCESSFUL! Game resuming in 10 seconds..."
- Failure: "😤 Weak engagement! Try harder next time! Game continuing..."