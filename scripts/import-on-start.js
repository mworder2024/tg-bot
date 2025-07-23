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

    // Mark as imported
    await redisClient.set('data_imported', '1');
    console.log('✅ Data import complete!');
    
  } catch (error) {
    console.error('❌ Error importing data:', error.message);
  }
}

module.exports = { importDataIfNeeded };