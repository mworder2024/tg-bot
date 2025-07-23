const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function manualImport() {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ REDIS_URL not found in environment variables');
    process.exit(1);
  }

  console.log('🔄 Connecting to Redis...');
  console.log(`📍 URL: ${redisUrl.replace(/:[^:@]*@/, ':****@')}`);
  
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 10000,
      reconnectStrategy: false // Don't retry for manual import
    }
  });

  client.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  try {
    await client.connect();
    console.log('✅ Connected to Redis successfully!\n');

    // Clear the import flag to force re-import
    await client.del('data_imported');
    console.log('🔄 Cleared import flag\n');

    let totalImported = 0;

    // 1. Import prize log
    const prizeLogPath = path.join(__dirname, '../src/config/prize-log.json');
    if (fs.existsSync(prizeLogPath)) {
      console.log('📂 Importing prize-log.json...');
      const prizeData = JSON.parse(fs.readFileSync(prizeLogPath, 'utf8'));
      await client.set('prizes:log', JSON.stringify(prizeData));
      console.log(`✅ Imported ${prizeData.length} prize records`);
      totalImported++;
    } else {
      console.log('⚠️  No prize-log.json found');
    }

    // 2. Import winner log
    const winnerLogPath = path.join(__dirname, '../src/config/winners-log.json');
    if (fs.existsSync(winnerLogPath)) {
      console.log('\n📂 Importing winners-log.json...');
      const winnerData = JSON.parse(fs.readFileSync(winnerLogPath, 'utf8'));
      await client.set('winners:log', JSON.stringify(winnerData));
      
      // Count unique winners
      const uniqueWinners = new Set(winnerData.map(w => w.userId)).size;
      console.log(`✅ Imported ${winnerData.length} winner records (${uniqueWinners} unique players)`);
      totalImported++;
    } else {
      console.log('⚠️  No winners-log.json found');
    }

    // 3. Import player stats
    const playerStatsPath = path.join(__dirname, '../data/player_stats.json');
    if (fs.existsSync(playerStatsPath)) {
      console.log('\n📂 Importing player_stats.json...');
      const statsData = JSON.parse(fs.readFileSync(playerStatsPath, 'utf8'));
      await client.set('leaderboard:stats', JSON.stringify(statsData));
      console.log(`✅ Imported ${statsData.length} player stats`);
      totalImported++;
    } else {
      console.log('⚠️  No player_stats.json found');
    }

    // 4. Import game count
    const gameHistoryPath = path.join(__dirname, '../data/game_history.json');
    if (fs.existsSync(gameHistoryPath)) {
      console.log('\n📂 Importing game_history.json...');
      const gameData = JSON.parse(fs.readFileSync(gameHistoryPath, 'utf8'));
      await client.set('leaderboard:game_count', gameData.length.toString());
      console.log(`✅ Imported game count: ${gameData.length}`);
      totalImported++;
    } else {
      console.log('⚠️  No game_history.json found');
    }

    // 5. Verify the data
    console.log('\n🔍 Verifying imported data...');
    
    const keys = await client.keys('*');
    console.log(`\n📦 Total keys in Redis: ${keys.length}`);
    console.log('🔑 Keys found:');
    for (const key of keys) {
      const type = await client.type(key);
      let size = 'N/A';
      
      if (type === 'string') {
        const value = await client.get(key);
        size = value ? `${value.length} chars` : '0 chars';
      } else if (type === 'set') {
        size = `${await client.sCard(key)} members`;
      }
      
      console.log(`   - ${key} (${type}, ${size})`);
    }

    // Mark as imported
    await client.set('data_imported', '1');
    
    console.log(`\n✅ Manual import complete! Imported ${totalImported} data files.`);
    console.log('\n💡 The bot should now show all stats correctly.');
    
    await client.disconnect();
    console.log('\n👋 Disconnected from Redis');
    
  } catch (error) {
    console.error('\n❌ Error during import:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Connection refused. Make sure you\'re running this with Railway environment.');
      console.log('   Try: railway run node scripts/manual-redis-import.js');
    }
    process.exit(1);
  }
}

// Run the import
console.log('🚀 Manual Redis Data Import for Lottery Bot');
console.log('=========================================\n');

manualImport();