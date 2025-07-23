const TelegramBot = require('node-telegram-bot-api');
const { performance } = require('perf_hooks');
const EventEmitter = require('events');

class TelegramBotStressTester extends EventEmitter {
  constructor(config) {
    super();
    this.config = {
      botToken: config.botToken || process.env.BOT_TOKEN,
      concurrentUsers: config.concurrentUsers || 50,
      testDuration: config.testDuration || 30000,
      messageDelay: config.messageDelay || 100,
      webhookUrl: config.webhookUrl || null,
      ...config
    };
    
    this.results = {
      totalMessages: 0,
      successfulMessages: 0,
      failedMessages: 0,
      responseTimes: [],
      errors: [],
      commandCounts: {},
      startTime: 0,
      endTime: 0
    };
    
    this.activeUsers = new Map();
    this.shouldStop = false;
  }

  generateMockUpdate(userId, command, params = {}) {
    const chatId = 1000000 + userId;
    const messageId = Math.floor(Math.random() * 1000000);
    
    return {
      update_id: messageId,
      message: {
        message_id: messageId,
        from: {
          id: userId,
          is_bot: false,
          first_name: `TestUser${userId}`,
          username: `testuser${userId}`,
          language_code: 'en'
        },
        chat: {
          id: chatId,
          first_name: `TestUser${userId}`,
          username: `testuser${userId}`,
          type: 'private'
        },
        date: Math.floor(Date.now() / 1000),
        text: command,
        ...params
      }
    };
  }

  async simulateUserInteraction(userId) {
    const commands = [
      '/start',
      '/join',
      '/wallet',
      '/leaderboard',
      '/help',
      '/stats',
      '/raffle info',
      '/tickets',
      '/buy 5',
      '/profile'
    ];
    
    const callbacks = [
      { data: 'join_raffle' },
      { data: 'view_leaderboard' },
      { data: 'wallet_connect' },
      { data: 'buy_tickets:5' },
      { data: 'confirm_purchase' }
    ];
    
    while (!this.shouldStop) {
      const startTime = performance.now();
      
      try {
        // Randomly choose between command and callback
        const isCallback = Math.random() > 0.5;
        let update;
        
        if (isCallback && callbacks.length > 0) {
          const callback = callbacks[Math.floor(Math.random() * callbacks.length)];
          update = {
            update_id: Math.floor(Math.random() * 1000000),
            callback_query: {
              id: `${userId}_${Date.now()}`,
              from: {
                id: userId,
                is_bot: false,
                first_name: `TestUser${userId}`,
                username: `testuser${userId}`
              },
              message: {
                message_id: Math.floor(Math.random() * 1000000),
                chat: {
                  id: 1000000 + userId,
                  type: 'private'
                }
              },
              data: callback.data
            }
          };
        } else {
          const command = commands[Math.floor(Math.random() * commands.length)];
          update = this.generateMockUpdate(userId, command);
          this.results.commandCounts[command] = (this.results.commandCounts[command] || 0) + 1;
        }
        
        // Send to webhook or simulate processing
        if (this.config.webhookUrl) {
          await this.sendWebhookUpdate(update);
        } else {
          await this.simulateBotProcessing(update);
        }
        
        const responseTime = performance.now() - startTime;
        this.results.responseTimes.push(responseTime);
        this.results.successfulMessages++;
        this.results.totalMessages++;
        
        this.emit('messageProcessed', { userId, responseTime });
        
      } catch (error) {
        this.results.failedMessages++;
        this.results.totalMessages++;
        this.results.errors.push({
          userId,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        
        this.emit('messageError', { userId, error: error.message });
      }
      
      // Delay between messages
      const delay = this.config.messageDelay + Math.random() * this.config.messageDelay;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  async sendWebhookUpdate(update) {
    const axios = require('axios');
    
    const response = await axios.post(this.config.webhookUrl, update, {
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': this.config.webhookSecret || 'test-secret'
      },
      timeout: 5000
    });
    
    if (response.status !== 200) {
      throw new Error(`Webhook returned ${response.status}`);
    }
  }

  async simulateBotProcessing(update) {
    // Simulate bot processing time
    const processingTime = 10 + Math.random() * 50; // 10-60ms
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Simulate some failures (5% error rate)
    if (Math.random() < 0.05) {
      throw new Error('Simulated processing error');
    }
  }

  async startTest() {
    console.log(`
🤖 Starting Telegram Bot Stress Test
====================================
Concurrent Users: ${this.config.concurrentUsers}
Test Duration: ${this.config.testDuration / 1000}s
Message Delay: ${this.config.messageDelay}ms
Target: ${this.config.webhookUrl || 'Local Simulation'}
====================================
`);

    this.results.startTime = performance.now();
    this.shouldStop = false;
    
    const userPromises = [];
    
    // Track progress
    let processed = 0;
    this.on('messageProcessed', () => {
      processed++;
      if (processed % 100 === 0) {
        console.log(`✓ Processed ${processed} messages...`);
      }
    });
    
    // Start virtual users
    for (let i = 0; i < this.config.concurrentUsers; i++) {
      const userId = 100000 + i;
      this.activeUsers.set(userId, true);
      userPromises.push(this.simulateUserInteraction(userId));
      
      if (i % 10 === 0) {
        console.log(`👥 Started ${i + 1}/${this.config.concurrentUsers} users`);
      }
      
      // Stagger user starts
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log('✅ All users active, running test...\n');
    
    // Run for specified duration
    await new Promise(resolve => setTimeout(resolve, this.config.testDuration));
    
    // Stop test
    console.log('\n🛑 Stopping test...');
    this.shouldStop = true;
    
    // Wait for all users to finish
    await Promise.all(userPromises.map(p => p.catch(() => {})));
    
    this.results.endTime = performance.now();
    
    // Generate report
    this.generateReport();
  }

  generateReport() {
    const duration = (this.results.endTime - this.results.startTime) / 1000;
    const avgResponseTime = this.results.responseTimes.reduce((a, b) => a + b, 0) / this.results.responseTimes.length;
    const throughput = this.results.totalMessages / duration;
    
    // Calculate percentiles
    const sorted = [...this.results.responseTimes].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    
    console.log(`
=====================================
    TELEGRAM BOT STRESS TEST REPORT
=====================================
Test Duration: ${duration.toFixed(2)}s
Total Messages: ${this.results.totalMessages}
Successful: ${this.results.successfulMessages} (${((this.results.successfulMessages / this.results.totalMessages) * 100).toFixed(2)}%)
Failed: ${this.results.failedMessages} (${((this.results.failedMessages / this.results.totalMessages) * 100).toFixed(2)}%)

Response Times:
  Average: ${avgResponseTime.toFixed(2)}ms
  P50: ${p50.toFixed(2)}ms
  P95: ${p95.toFixed(2)}ms
  P99: ${p99.toFixed(2)}ms

Throughput: ${throughput.toFixed(2)} messages/s

Command Distribution:
${Object.entries(this.results.commandCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([cmd, count]) => `  ${cmd}: ${count}`)
  .join('\n')}

${this.results.errors.length > 0 ? `\nErrors (first 5):\n${this.results.errors.slice(0, 5).map(e => `  - User ${e.userId}: ${e.error}`).join('\n')}` : ''}
=====================================
`);
  }

  async testBurstScenario() {
    console.log(`
💥 Testing Burst Scenario
=========================
Simulating sudden spike of users joining
`);
    
    this.results = {
      totalMessages: 0,
      successfulMessages: 0,
      failedMessages: 0,
      responseTimes: [],
      errors: [],
      commandCounts: {},
      startTime: performance.now(),
      endTime: 0
    };
    
    const burstSize = 100;
    const promises = [];
    
    // All users send /start and /join simultaneously
    for (let i = 0; i < burstSize; i++) {
      const userId = 200000 + i;
      
      promises.push((async () => {
        try {
          const startUpdate = this.generateMockUpdate(userId, '/start');
          await this.simulateBotProcessing(startUpdate);
          
          const joinUpdate = this.generateMockUpdate(userId, '/join');
          await this.simulateBotProcessing(joinUpdate);
          
          this.results.successfulMessages += 2;
          this.results.totalMessages += 2;
          
        } catch (error) {
          this.results.failedMessages += 2;
          this.results.totalMessages += 2;
          this.results.errors.push({ userId, error: error.message });
        }
      })());
    }
    
    await Promise.all(promises);
    this.results.endTime = performance.now();
    
    const duration = (this.results.endTime - this.results.startTime) / 1000;
    console.log(`
Burst Test Results:
  Duration: ${duration.toFixed(2)}s
  Total Messages: ${this.results.totalMessages}
  Success Rate: ${((this.results.successfulMessages / this.results.totalMessages) * 100).toFixed(2)}%
  Messages/Second: ${(this.results.totalMessages / duration).toFixed(2)}
`);
  }

  async testDatabaseLimits() {
    console.log(`
🗄️  Testing Database Connection Limits
=====================================
Simulating extreme concurrent database operations
`);
    
    // Simulate 200 users all checking leaderboard simultaneously
    const promises = [];
    const startTime = performance.now();
    
    for (let i = 0; i < 200; i++) {
      promises.push((async () => {
        const userId = 300000 + i;
        const update = this.generateMockUpdate(userId, '/leaderboard');
        
        try {
          await this.simulateBotProcessing(update);
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      })());
    }
    
    const results = await Promise.all(promises);
    const duration = (performance.now() - startTime) / 1000;
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`
Database Limit Test Results:
  Duration: ${duration.toFixed(2)}s
  Successful: ${successful}
  Failed: ${failed}
  Success Rate: ${((successful / results.length) * 100).toFixed(2)}%
`);
  }

  async runComprehensiveTest() {
    console.log(`
🏁 Running Comprehensive Telegram Bot Stress Test
================================================
`);
    
    // Test 1: Normal load
    console.log('\n📊 Test 1: Normal Load (25 users, 30s)');
    this.config.concurrentUsers = 25;
    this.config.testDuration = 30000;
    await this.startTest();
    
    // Cool down
    console.log('\n⏸️  Cooling down...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Test 2: Heavy load
    console.log('\n📊 Test 2: Heavy Load (50 users, 30s)');
    this.config.concurrentUsers = 50;
    await this.startTest();
    
    // Cool down
    console.log('\n⏸️  Cooling down...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Test 3: Burst scenario
    await this.testBurstScenario();
    
    // Test 4: Database limits
    await this.testDatabaseLimits();
    
    console.log('\n✅ All tests completed!');
  }
}

// Webhook server simulator for testing
class WebhookServerSimulator {
  constructor(port = 3002) {
    this.port = port;
    this.requestCount = 0;
    this.errors = 0;
  }

  async start() {
    const express = require('express');
    const app = express();
    
    app.use(express.json());
    
    app.post('/webhook', (req, res) => {
      this.requestCount++;
      
      // Simulate processing
      setTimeout(() => {
        // Random errors (2%)
        if (Math.random() < 0.02) {
          this.errors++;
          res.status(500).json({ error: 'Internal server error' });
        } else {
          res.status(200).json({ ok: true });
        }
      }, Math.random() * 100); // 0-100ms processing time
    });
    
    this.server = app.listen(this.port, () => {
      console.log(`🌐 Webhook simulator listening on port ${this.port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log(`
Webhook Server Stats:
  Total Requests: ${this.requestCount}
  Errors: ${this.errors}
  Success Rate: ${(((this.requestCount - this.errors) / this.requestCount) * 100).toFixed(2)}%
`);
    }
  }
}

// Main test runner
async function runTests() {
  const tester = new TelegramBotStressTester({
    botToken: process.env.BOT_TOKEN,
    webhookUrl: process.env.WEBHOOK_URL || null,
    webhookSecret: process.env.WEBHOOK_SECRET
  });
  
  let webhookServer = null;
  
  try {
    // Start webhook server if testing webhook mode
    if (process.env.TEST_WEBHOOK === 'true') {
      webhookServer = new WebhookServerSimulator();
      await webhookServer.start();
      tester.config.webhookUrl = 'http://localhost:3002/webhook';
    }
    
    // Run comprehensive tests
    await tester.runComprehensiveTest();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    if (webhookServer) {
      webhookServer.stop();
    }
    process.exit(0);
  }
}

// Export for use as module
module.exports = {
  TelegramBotStressTester,
  WebhookServerSimulator
};

// Run if called directly
if (require.main === module) {
  runTests();
}