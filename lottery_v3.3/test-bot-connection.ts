import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testBot() {
  console.log('🔍 Testing Enhanced Bot Connection...\n');

  // Check bot token
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error('❌ BOT_TOKEN not found in .env file');
    process.exit(1);
  }

  console.log('✅ BOT_TOKEN found');

  // Create bot instance
  const bot = new Telegraf(token);
  
  try {
    // Get bot info
    console.log('\n📡 Connecting to Telegram...');
    const me = await bot.telegram.getMe();
    
    console.log('\n✅ Bot connected successfully!');
    console.log(`🤖 Bot Username: @${me.username}`);
    console.log(`🆔 Bot ID: ${me.id}`);
    console.log(`📝 Bot Name: ${me.first_name}`);
    
    // Test a simple command
    bot.command('test', (ctx) => {
      console.log(`\n📨 Received test command from user ${ctx.from?.id}`);
      ctx.reply('✅ Bot is working! Enhanced features are active.');
    });
    
    // Test callback handler
    bot.on('callback_query', (ctx) => {
      console.log(`\n🔘 Received callback: ${(ctx.callbackQuery as any).data}`);
      ctx.answerCbQuery('Callback received!');
    });
    
    // Log all messages for debugging
    bot.on('message', (ctx) => {
      const text = (ctx.message as any).text || '(no text)';
      console.log(`\n💬 Message from ${ctx.from?.id}: ${text}`);
    });
    
    console.log('\n🚀 Starting bot...');
    console.log('📝 Available commands:');
    console.log('  /test - Test if bot is working');
    console.log('  /admin - Open admin menu (admin only)');
    console.log('  /startlottery - Start a new game');
    console.log('  /join - Join active game');
    console.log('\n⏳ Bot is now running. Press Ctrl+C to stop.\n');
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    
    await bot.launch();
    
  } catch (error: any) {
    console.error('\n❌ Failed to connect bot:');
    console.error(`   Error: ${error.message}`);
    
    if (error.message.includes('401')) {
      console.error('\n⚠️  Bot token is invalid. Please check your BOT_TOKEN in .env');
    } else if (error.message.includes('ENOTFOUND')) {
      console.error('\n⚠️  Network error. Check your internet connection.');
    } else if (error.message.includes('409')) {
      console.error('\n⚠️  Another instance of the bot is already running.');
    }
    
    process.exit(1);
  }
}

// Run test
testBot().catch(console.error);