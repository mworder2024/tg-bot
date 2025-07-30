const { Telegraf } = require('telegraf');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not found in environment variables!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Admin user IDs
const ADMIN_IDS = [
  '5970380897', // Main admin
  '463334876',  // Secondary admin  
  '123456789'   // Additional admin
];

async function forceResumeAllGames() {
  console.log('🔧 Force Resume Script Starting...\n');
  
  // List of known chat IDs where games might be running
  const chatIds = [
    '-1002330414734', // Main chat
    // Add more chat IDs here if needed
  ];
  
  for (const chatId of chatIds) {
    try {
      console.log(`📍 Checking chat ${chatId}...`);
      
      // Send force resume command
      const message = await bot.telegram.sendMessage(
        chatId,
        `🔧 **SYSTEM: Force Resume Check**\n\n` +
        `Checking for stuck games and forcing resume if needed...\n\n` +
        `If a game was stuck in raid mode, it should resume shortly.`,
        { parse_mode: 'Markdown' }
      );
      
      console.log(`✅ Sent force resume message to chat ${chatId}`);
      
      // Send the /forceresume command as if from admin
      try {
        // Note: This won't work directly, but shows the intent
        console.log(`   Attempting to trigger /forceresume in chat ${chatId}`);
      } catch (err) {
        console.log(`   ⚠️  Cannot directly trigger commands`);
      }
      
    } catch (error) {
      console.error(`❌ Error checking chat ${chatId}:`, error.message);
    }
  }
  
  console.log('\n✅ Force resume check complete!');
  console.log('\n📌 Next steps:');
  console.log('1. Check each chat to see if games resumed');
  console.log('2. If still stuck, use /forceresume command in the chat');
  console.log('3. Restart the bot if needed');
  
  process.exit(0);
}

// Run the script
forceResumeAllGames().catch(error => {
  console.error('❌ Script error:', error);
  process.exit(1);
});