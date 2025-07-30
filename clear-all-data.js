const redis = require('redis');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

async function clearAllData() {
  console.log('🗑️  Starting complete data wipe...\n');

  // 1. Clear Redis
  console.log('🔴 Clearing Redis cache...');
  try {
    const redisUrl = process.env.REDIS_URL || process.env.REDIS_URL_DEV;
    const client = redis.createClient({ url: redisUrl });
    
    await client.connect();
    console.log('✅ Connected to Redis');
    
    // Get all keys and delete them
    const keys = await client.keys('*');
    console.log(`📊 Found ${keys.length} keys in Redis`);
    
    if (keys.length > 0) {
      await client.del(keys);
      console.log('✅ All Redis keys deleted');
    }
    
    await client.quit();
    console.log('✅ Redis cleared and disconnected\n');
  } catch (error) {
    console.error('❌ Redis error:', error.message);
    console.log('⚠️  Continuing with file cleanup...\n');
  }

  // 2. Clear game files
  const filesToClear = [
    'data/games.json',
    'data/lotteryGames.json',
    'data/frozen_games.json',
    'data/game_history.json',
    'data/player_stats.json'
  ];

  console.log('📁 Clearing game data files...');
  for (const file of filesToClear) {
    const filePath = path.join(__dirname, file);
    try {
      if (fs.existsSync(filePath)) {
        // Keep the file but make it empty
        if (file.includes('games.json')) {
          fs.writeFileSync(filePath, '{}');
        } else if (file.includes('.json')) {
          fs.writeFileSync(filePath, '[]');
        }
        console.log(`✅ Cleared: ${file}`);
      } else {
        console.log(`⏭️  Skipped (not found): ${file}`);
      }
    } catch (error) {
      console.error(`❌ Error clearing ${file}:`, error.message);
    }
  }

  // 3. Clear PM2 logs
  console.log('\n📝 Clearing PM2 logs...');
  try {
    const { execSync } = require('child_process');
    execSync('pm2 flush', { stdio: 'inherit' });
    console.log('✅ PM2 logs cleared');
  } catch (error) {
    console.log('⚠️  Could not clear PM2 logs');
  }

  console.log('\n✨ Complete data wipe finished!');
  console.log('🚀 You can now start fresh with: npm run start');
}

clearAllData().catch(console.error);