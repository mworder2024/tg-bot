const fs = require('fs');
const path = require('path');

// Read games from file
const gamesFile = path.join(process.cwd(), 'src', 'config', 'games.json');

if (!fs.existsSync(gamesFile)) {
  console.log('❌ No games file found!');
  process.exit(1);
}

const gamesData = JSON.parse(fs.readFileSync(gamesFile, 'utf8'));

console.log(`\n🔍 Checking ${Object.keys(gamesData).length} chats for stuck raid status...\n`);

let unfrozenCount = 0;

for (const [chatId, chatGames] of Object.entries(gamesData)) {
  // Handle multi-game format
  if (typeof chatGames === 'object' && !Array.isArray(chatGames) && !chatGames.players) {
    // This is multi-game format
    for (const [gameId, game] of Object.entries(chatGames)) {
      if (game && game.state === 'DRAWING' && (game.raidPaused || game.raidMonitorActive)) {
        console.log(`\n🚨 Found stuck game in chat ${chatId}:`);
        console.log(`   Game ID: ${game.gameId}`);
        console.log(`   State: ${game.state}`);
        console.log(`   Raid Paused: ${game.raidPaused}`);
        console.log(`   Raid Monitor Active: ${game.raidMonitorActive}`);
        console.log(`   Players: ${game.players ? game.players.length : 0}`);
        
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
  } else {
    // Legacy single game format
    const game = chatGames;
    if (game && game.state === 'DRAWING' && (game.raidPaused || game.raidMonitorActive)) {
      console.log(`\n🚨 Found stuck game in chat ${chatId}:`);
      console.log(`   Game ID: ${game.gameId}`);
      console.log(`   State: ${game.state}`);
      console.log(`   Raid Paused: ${game.raidPaused}`);
      console.log(`   Raid Monitor Active: ${game.raidMonitorActive}`);
      console.log(`   Players: ${game.players ? game.players.length : 0}`);
      
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
}

if (unfrozenCount === 0) {
  console.log('✅ No stuck games found!');
} else {
  // Save the updated games back to file
  fs.writeFileSync(gamesFile, JSON.stringify(gamesData, null, 2));
  console.log(`\n🎉 Successfully unfroze ${unfrozenCount} game(s)!`);
  console.log('\n⚠️  IMPORTANT: Restart the bot for the games to resume drawing.');
}