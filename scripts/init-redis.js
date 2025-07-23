const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function initializeRedis() {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ REDIS_URL not found in environment variables');
    console.log('\nPlease set REDIS_URL in your .env file or environment');
    console.log('Example: REDIS_URL=redis://default:password@host:6379');
    process.exit(1);
  }

  console.log('🔄 Connecting to Redis...');
  console.log(`📍 URL: ${redisUrl.replace(/:[^:@]*@/, ':****@')}`); // Hide password
  
  const client = createClient({
    url: redisUrl
  });

  client.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  try {
    await client.connect();
    console.log('✅ Connected to Redis successfully!\n');

    // Initialize data structures from local files
    console.log('📝 Loading local data...\n');

    let totalKeysImported = 0;

    // 1. Load games data
    const gamesPath = path.join(__dirname, '../src/config/games.json');
    if (fs.existsSync(gamesPath)) {
      console.log('📂 Loading games.json...');
      const gamesData = JSON.parse(fs.readFileSync(gamesPath, 'utf8'));
      
      let gameCount = 0;
      for (const [chatId, game] of Object.entries(gamesData)) {
        const gameKey = `games:state:active:${chatId}`;
        await client.set(gameKey, JSON.stringify(game), {
          EX: 86400 // 24 hours TTL
        });
        gameCount++;
      }
      console.log(`✅ Imported ${gameCount} active games\n`);
      totalKeysImported += gameCount;
    } else {
      console.log('⚠️  No games.json found\n');
    }

    // 2. Load groups data
    const groupsPath = path.join(__dirname, '../src/config/groups.json');
    if (fs.existsSync(groupsPath)) {
      console.log('📂 Loading groups.json...');
      const groupsData = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
      
      // Store admin list
      if (groupsData.admins && groupsData.admins.length > 0) {
        await client.del('admins'); // Clear existing
        await client.sAdd('admins', groupsData.admins.map(String));
        console.log(`✅ Imported ${groupsData.admins.length} admins`);
        totalKeysImported++;
      }
      
      // Store allowed groups
      if (groupsData.allowedGroups && groupsData.allowedGroups.length > 0) {
        await client.del('allowed_groups'); // Clear existing
        await client.sAdd('allowed_groups', groupsData.allowedGroups.map(String));
        console.log(`✅ Imported ${groupsData.allowedGroups.length} allowed groups\n`);
        totalKeysImported++;
      }
    } else {
      console.log('⚠️  No groups.json found\n');
    }

    // 3. Load prize log
    const prizeLogPath = path.join(__dirname, '../src/config/prize-log.json');
    if (fs.existsSync(prizeLogPath)) {
      console.log('📂 Loading prize-log.json...');
      const prizeData = JSON.parse(fs.readFileSync(prizeLogPath, 'utf8'));
      await client.set('prizes:log', JSON.stringify(prizeData));
      
      // Count prizes
      let prizeCount = 0;
      for (const prizes of Object.values(prizeData)) {
        prizeCount += Object.keys(prizes).length;
      }
      console.log(`✅ Imported ${prizeCount} prize records\n`);
      totalKeysImported++;
    } else {
      console.log('⚠️  No prize-log.json found\n');
    }

    // 4. Load winner log
    const winnerLogPath = path.join(__dirname, '../src/config/winners-log.json');
    if (fs.existsSync(winnerLogPath)) {
      console.log('📂 Loading winners-log.json...');
      const winnerData = JSON.parse(fs.readFileSync(winnerLogPath, 'utf8'));
      await client.set('winners:log', JSON.stringify(winnerData));
      
      // Count winners
      let winnerCount = 0;
      for (const winners of Object.values(winnerData)) {
        winnerCount += winners.length;
      }
      console.log(`✅ Imported ${winnerCount} winner records\n`);
      totalKeysImported++;
    } else {
      console.log('⚠️  No winners-log.json found\n');
    }

    // 5. Initialize empty structures if they don't exist
    console.log('🏗️  Initializing data structures...');
    
    // Check if leaderboard exists
    const leaderboardExists = await client.exists('leaderboard');
    if (!leaderboardExists) {
      // Create empty leaderboard
      console.log('📊 Created empty leaderboard');
    }
    
    console.log('\n✅ Redis initialization complete!');
    console.log(`📊 Total keys imported: ${totalKeysImported}`);
    
    // Show all keys
    const keys = await client.keys('*');
    console.log(`📦 Total keys in Redis: ${keys.length}\n`);
    
    if (keys.length > 0) {
      console.log('🔑 Keys in Redis:');
      keys.forEach(key => console.log(`   - ${key}`));
    }
    
    await client.disconnect();
    console.log('\n👋 Disconnected from Redis');
    
  } catch (error) {
    console.error('\n❌ Error initializing Redis:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Make sure your Redis server is running and accessible');
      console.log('   Check your REDIS_URL in the .env file');
    }
    process.exit(1);
  }
}

// Show usage
console.log('🚀 Redis Data Importer for Lottery Bot');
console.log('=====================================\n');

// Run the initialization
initializeRedis();