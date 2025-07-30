# Instructions to Unfreeze Stuck Raid Game

## Option 1: Use Telegram Commands (Recommended)

1. **Open the Telegram chat** where the game is stuck
2. **Use the `/raidstatus` command** to check the current raid state
3. **Use the `/forceresume` command** to manually resume the game
   - Only admins can use this command
   - Admin IDs: 5970380897, 463334876

## Option 2: Restart the Bot

Since all saved games show as FINISHED, the stuck game is likely only in memory.

1. **Stop the bot**:
   ```bash
   # Find the bot process
   ps aux | grep "node dist/index.js"
   
   # Kill the process (replace PID with actual process ID)
   kill PID
   ```

2. **Start the bot again**:
   ```bash
   npm start
   ```

## What Was Fixed

I've implemented several improvements to prevent future stuck states:

1. **Automatic Timeout (15 minutes)**
   - Games will auto-resume after 15 minutes if no raid completion is detected
   - Sends a clear notification when timeout occurs

2. **Enhanced Cleanup**
   - Added timeout timer cleanup in all scenarios:
     - Successful raid completion
     - Failed raid
     - Manual force resume
     - Game finish
     - Game cancellation

3. **Better Status Reporting**
   - `/raidstatus` now shows timeout timer and reminder interval status

4. **Error Recovery**
   - Improved error handling to clear timers even when errors occur

## Prevention

The new code will prevent games from getting permanently stuck. Features include:
- 15-minute automatic timeout
- Proper timer cleanup in all code paths
- Better error recovery
- Enhanced status visibility

The game should never get stuck indefinitely again!