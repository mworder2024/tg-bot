import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function initializeRedis() {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ REDIS_URL not found in environment variables');
    process.exit(1);
  }

  console.log('🔄 Connecting to Redis...');
  
  const client = createClient({
    url: redisUrl
  });

  client.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  try {
    await client.connect();
    console.log('✅ Connected to Redis');

    // Initialize data structures from local files
    console.log('📝 Initializing data structures...');

    // 1. Load games data
    const gamesPath = path.join(__dirname, '../src/config/games.json');
    if (fs.existsSync(gamesPath)) {
      const gamesData = JSON.parse(fs.readFileSync(gamesPath, 'utf8'));
      
      for (const [chatId, game] of Object.entries(gamesData)) {
        const gameKey = `games:state:active:${chatId}`;
        await client.set(gameKey, JSON.stringify(game), {
          EX: 86400 // 24 hours TTL
        });
        console.log(`✅ Loaded game for chat ${chatId}`);
      }
    }

    // 2. Load groups data
    const groupsPath = path.join(__dirname, '../src/config/groups.json');
    if (fs.existsSync(groupsPath)) {
      const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
      
      // Store admin list
      if (groupsData.admins && groupsData.admins.length > 0) {
        await client.sAdd('admins', groupsData.admins.map(String));
        console.log(`✅ Loaded ${groupsData.admins.length} admins`);
      }
      
      // Store allowed groups
      if (groupsData.allowedGroups && groupsData.allowedGroups.length > 0) {
        await client.sAdd('allowed_groups', groupsData.allowedGroups.map(String));
        console.log(`✅ Loaded ${groupsData.allowedGroups.length} allowed groups`);
      }
    }

    // 3. Load prize log
    const prizeLogPath = path.join(__dirname, '../src/config/prize-log.json');
    if (fs.existsSync(prizeLogPath)) {
      const prizeData = JSON.parse(fs.readFileSync(prizeLogPath, 'utf8'));
      await client.set('prizes:log', JSON.stringify(prizeData));
      console.log('✅ Loaded prize log');
    }

    // 4. Load winner log
    const winnerLogPath = path.join(__dirname, '../src/config/winners-log.json');
    if (fs.existsSync(winnerLogPath)) {
      const winnerData = JSON.parse(fs.readFileSync(winnerLogPath, 'utf8'));
      await client.set('winners:log', JSON.stringify(winnerData));
      console.log('✅ Loaded winner log');
    }

    // 5. Initialize key data structures
    console.log('🏗️ Initializing key structures...');
    
    // Leaderboard (sorted set)
    // Format: ZADD leaderboard score userId
    
    // Stats hash for each user
    // Format: HSET stats:userId field value
    
    // Game history
    // Format: SET game:history:gameId gameData
    
    console.log('✅ Redis initialization complete!');
    
    // Show some stats
    const keys = await client.keys('*');
    console.log(`\n📊 Total keys in Redis: ${keys.length}`);
    
    await client.disconnect();
    
  } catch (error) {
    console.error('❌ Error initializing Redis:', error);
    process.exit(1);
  }
}

// Run the initialization
initializeRedis();