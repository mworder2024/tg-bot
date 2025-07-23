// This script can be added to your bot's startup to import data if Redis is empty
const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

async function importDataIfNeeded(redisClient) {
  try {
    // Check if data already exists
    const hasData = await redisClient.exists('data_imported');
    if (hasData) {
      console.log('📊 Data already imported to Redis');
      return;
    }

    console.log('📝 First run detected, importing local data to Redis...');

    // 1. Load games data
    const gamesPath = path.join(__dirname, '../src/config/games.json');
    if (fs.existsSync(gamesPath)) {
      const gamesData = JSON.parse(fs.readFileSync(gamesPath, 'utf8'));
      
      for (const [chatId, game] of Object.entries(gamesData)) {
        const gameKey = `games:state:active:${chatId}`;
        await redisClient.set(gameKey, JSON.stringify(game), {
          EX: 86400 // 24 hours TTL
        });
      }
      console.log(`✅ Imported ${Object.keys(gamesData).length} active games`);
    }

    // 2. Load groups data
    const groupsPath = path.join(__dirname, '../src/config/groups.json');
    if (fs.existsSync(groupsPath)) {
      const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
      
      if (groupsData.admins && groupsData.admins.length > 0) {
        await redisClient.sAdd('admins', groupsData.admins.map(String));
        console.log(`✅ Imported ${groupsData.admins.length} admins`);
      }
      
      if (groupsData.allowedGroups && groupsData.allowedGroups.length > 0) {
        await redisClient.sAdd('allowed_groups', groupsData.allowedGroups.map(String));
        console.log(`✅ Imported ${groupsData.allowedGroups.length} allowed groups`);
      }
    }

    // 3. Load prize log
    const prizeLogPath = path.join(__dirname, '../src/config/prize-log.json');
    if (fs.existsSync(prizeLogPath)) {
      const prizeData = JSON.parse(fs.readFileSync(prizeLogPath, 'utf8'));
      await redisClient.set('prizes:log', JSON.stringify(prizeData));
      console.log('✅ Imported prize log');
    }

    // 4. Load winner log
    const winnerLogPath = path.join(__dirname, '../src/config/winners-log.json');
    if (fs.existsSync(winnerLogPath)) {
      const winnerData = JSON.parse(fs.readFileSync(winnerLogPath, 'utf8'));
      await redisClient.set('winners:log', JSON.stringify(winnerData));
      console.log('✅ Imported winner log');
    }

    // 5. Load player stats for leaderboard
    const playerStatsPath = path.join(__dirname, '../data/player_stats.json');
    if (fs.existsSync(playerStatsPath)) {
      const statsData = JSON.parse(fs.readFileSync(playerStatsPath, 'utf8'));
      await redisClient.set('leaderboard:stats', JSON.stringify(statsData));
      console.log(`✅ Imported ${statsData.length} player stats for leaderboard`);
    }

    // 6. Load game history count
    const gameHistoryPath = path.join(__dirname, '../data/game_history.json');
    if (fs.existsSync(gameHistoryPath)) {
      const gameData = JSON.parse(fs.readFileSync(gameHistoryPath, 'utf8'));
      await redisClient.set('leaderboard:game_count', gameData.length.toString());
      console.log(`✅ Imported game count: ${gameData.length}`);
    }

    // Mark as imported
    await redisClient.set('data_imported', '1');
    console.log('✅ Data import complete!');
    
  } catch (error) {
    console.error('❌ Error importing data:', error.message);
  }
}

module.exports = { importDataIfNeeded };