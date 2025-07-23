const { Telegraf } = require('telegraf');
require('dotenv').config();

// Test configuration
const TEST_CHAT_ID = process.env.TEST_CHAT_ID || '-1001234567890'; // Replace with your test group
const MESSAGES_TO_SEND = 100;
const CONCURRENT_SENDERS = 10;

// Create test bot
const testBot = new Telegraf(process.env.BOT_TOKEN);

// Statistics
let sent = 0;
let failed = 0;
let rateLimited = 0;

async function sendTestMessage(index, sender) {
  try {
    const message = `Test message ${index} from sender ${sender} at ${new Date().toISOString()}`;
    await testBot.telegram.sendMessage(TEST_CHAT_ID, message);
    sent++;
    console.log(`✅ Sent: ${sent}/${MESSAGES_TO_SEND}`);
  } catch (error) {
    failed++;
    if (error.response?.error_code === 429) {
      rateLimited++;
      console.log(`⚠️ Rate limited! Total: ${rateLimited}`);
      console.log(`   Retry after: ${error.response.parameters?.retry_after || 'unknown'} seconds`);
    } else {
      console.log(`❌ Error: ${error.message}`);
    }
  }
}

async function runLoadTest() {
  console.log(`🚀 Starting rate limit test...`);
  console.log(`📊 Sending ${MESSAGES_TO_SEND} messages with ${CONCURRENT_SENDERS} concurrent senders`);
  console.log(`🎯 Target chat: ${TEST_CHAT_ID}\n`);

  const startTime = Date.now();
  const promises = [];

  // Create concurrent senders
  for (let sender = 0; sender < CONCURRENT_SENDERS; sender++) {
    const senderPromise = (async () => {
      for (let i = sender; i < MESSAGES_TO_SEND; i += CONCURRENT_SENDERS) {
        await sendTestMessage(i, sender);
        // No delay - we want to trigger rate limits
      }
    })();
    promises.push(senderPromise);
  }

  // Wait for all senders to complete
  await Promise.all(promises);

  const duration = (Date.now() - startTime) / 1000;

  console.log(`\n📊 Test Results:`);
  console.log(`✅ Successfully sent: ${sent}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️ Rate limited: ${rateLimited}`);
  console.log(`⏱️ Duration: ${duration.toFixed(2)} seconds`);
  console.log(`📈 Rate: ${(sent / duration).toFixed(2)} messages/second`);

  process.exit(0);
}

// Verify bot token
testBot.telegram.getMe()
  .then(botInfo => {
    console.log(`✅ Bot authenticated: @${botInfo.username}`);
    console.log(`\n⚠️ WARNING: This will send many messages to test rate limiting!`);
    console.log(`Make sure TEST_CHAT_ID is set to a test group.\n`);
    
    // Give time to cancel if needed
    setTimeout(runLoadTest, 3000);
  })
  .catch(error => {
    console.error(`❌ Bot authentication failed:`, error.message);
    process.exit(1);
  });