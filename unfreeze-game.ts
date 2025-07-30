import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

config();

async function unfreezeGame() {
  // Read games from file
  const dataDir = path.join(process.cwd(), 'data');
  const gamesFile = path.join(dataDir, 'games.json');
  
  if (!fs.existsSync(gamesFile)) {
    console.log('❌ No games file found!');
    process.exit(1);
  }
  
  const gamesData = JSON.parse(fs.readFileSync(gamesFile, 'utf8'));
  const games = gamesData.currentGames || {};
  
  console.log(`\n🔍 Checking ${Object.keys(games).length} games for stuck raid status...\n`);
  
  let unfrozenCount = 0;
  
  for (const [chatId, game] of Object.entries(games)) {
    if (game && game.state === 'DRAWING' && (game.raidPaused || game.raidMonitorActive)) {
      console.log(`\n🚨 Found stuck game in chat ${chatId}:`);
      console.log(`   Game ID: ${game.gameId}`);
      console.log(`   State: ${game.state}`);
      console.log(`   Raid Paused: ${game.raidPaused}`);
      console.log(`   Raid Monitor Active: ${game.raidMonitorActive}`);
      console.log(`   Players: ${Object.keys(game.players || {}).length}`);
      
      // Clear raid state
      game.raidPaused = false;
      game.raidMonitorActive = false;
      delete game.raidReminderInterval;
      delete game.raidTimeoutTimer;
      
      console.log(`   ✅ Game unfrozen! Raid state cleared.`);
      console.log(`   ℹ️  The game will automatically resume drawing when the bot restarts.`);
      
      unfrozenCount++;
    }
  }
  
  if (unfrozenCount === 0) {
    console.log('✅ No stuck games found!');
  } else {
    // Save the updated games back to file
    fs.writeFileSync(gamesFile, JSON.stringify(gamesData, null, 2));
    console.log(`\n🎉 Successfully unfroze ${unfrozenCount} game(s)!`);
    console.log('\n⚠️  IMPORTANT: Restart the bot for the games to resume drawing.');
  }
  
  process.exit(0);
}

// Run the unfreeze script
unfreezeGame().catch(error => {
  console.error('❌ Error unfreezing games:', error);
  process.exit(1);
});