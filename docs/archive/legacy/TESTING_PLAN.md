# Testing Plan for Optimized Bot

## Overview

This testing plan ensures the optimized bot performs correctly under various conditions, especially focusing on rate limit resilience and message reduction.

## Test Scenarios

### 1. Basic Functionality Tests

#### Test 1.1: Game Creation
**Steps:**
1. Run `/create` command
2. Verify game is created with proper configuration
3. Check timer shows exact start time (e.g., "14:30")
4. Confirm countdown messages are scheduled

**Expected Results:**
- Game created successfully
- Exact start time displayed
- Scheduled start stored in gameTimerManager

#### Test 1.2: Player Joining
**Steps:**
1. Have 5 players join within 10 seconds
2. Observe message output
3. Check individual confirmations
4. Wait for buffered announcement

**Expected Results:**
- Each player gets personal confirmation
- NO individual join announcements in group
- One combined message after 5 seconds: "👥 Player1, Player2, Player3, Player4 and Player5 joined! (5/50)"

### 2. Rate Limit Resilience Tests

#### Test 2.1: Simulated Rate Limit During Join
**Steps:**
1. Create game
2. Have 20+ players join rapidly (simulate rate limit scenario)
3. Monitor bot behavior
4. Check if game starts on time

**Expected Results:**
- Bot doesn't crash or loop
- Messages are queued, not lost
- Game starts at scheduled time regardless

#### Test 2.2: Recovery After Rate Limit
**Steps:**
1. Trigger rate limit (rapid message sending)
2. Wait for bot to be rate limited
3. Check if scheduled game still starts
4. Verify no message spam during recovery

**Expected Results:**
- Bot enters rate limit mode gracefully
- Game timer continues independently
- Game starts at absolute scheduled time
- No cascade of retry messages

### 3. Message Throttling Tests

#### Test 3.1: Already Joined Throttle
**Steps:**
1. Player joins game
2. Same player tries `/join` 5 times rapidly
3. Monitor group messages

**Expected Results:**
- First attempt: "✅ Already in game! (X/Y)"
- Next 4 attempts within 30s: No group message
- After 30s: Message allowed again

#### Test 3.2: No Game Running Throttle
**Steps:**
1. No active game
2. Multiple users try `/join` repeatedly
3. Monitor group messages

**Expected Results:**
- First message: "🎮 No active game. Use /create to start one."
- Subsequent messages within 30s: Suppressed
- After 30s: One message allowed

### 4. Game Start Reliability Tests

#### Test 4.1: Normal Start
**Steps:**
1. Create game with 5-minute timer
2. Let timer run naturally
3. Verify game starts at exact scheduled time

**Expected Results:**
- Game starts within 10 seconds of scheduled time
- Start message includes full player list with numbers
- All players properly assigned numbers

#### Test 4.2: Start After Bot Restart
**Steps:**
1. Create game with 10-minute timer
2. After 2 minutes, restart bot
3. Wait for scheduled start time

**Expected Results:**
- Bot loads persisted game state
- Timer manager recognizes overdue game
- Game starts at originally scheduled time

#### Test 4.3: Force Start
**Steps:**
1. Create game
2. Use `/forcestart` as admin
3. Verify immediate start

**Expected Results:**
- Game starts immediately
- Timer properly cancelled
- Full player list shown

### 5. Performance Tests

#### Test 5.1: Message Count Comparison
**Metric Collection:**
```bash
# Before optimization
grep -c "Sending message" bot.log.before

# After optimization  
grep -c "Sending message" bot.log.after
```

**Target:** 50%+ reduction in messages

#### Test 5.2: Large Game Test
**Steps:**
1. Create game with 50 max players
2. Have all 50 join
3. Let game run to completion
4. Count total messages sent

**Expected Results:**
- Join messages: ~10 (buffered)
- Game messages: ~20-30
- Total: <40 messages (vs 100+ before)

### 6. Edge Case Tests

#### Test 6.1: Rapid Game Creation
**Steps:**
1. Create game
2. All players join
3. Game fills and starts
4. Immediately create new game
5. Players join new game

**Expected Results:**
- Clean transition between games
- No lingering timers
- Proper cleanup of join buffers

#### Test 6.2: Multiple Groups
**Steps:**
1. Run bot in 3 different groups
2. Create games simultaneously
3. Have players join all games
4. Monitor cross-group interference

**Expected Results:**
- Each group independent
- No message leakage
- Proper throttling per group

## Automated Test Script

```javascript
// test-bot.js
const { spawn } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');

// Test configuration
const TEST_BOT_TOKEN = process.env.TEST_BOT_TOKEN;
const TEST_CHAT_ID = process.env.TEST_CHAT_ID;
const MAIN_BOT_USERNAME = '@YourLotteryBot';

class BotTester {
  constructor() {
    this.bot = new TelegramBot(TEST_BOT_TOKEN, { polling: true });
    this.results = [];
  }

  async runTests() {
    console.log('Starting automated tests...');
    
    await this.testGameCreation();
    await this.testJoinBuffering();
    await this.testMessageThrottling();
    await this.testGameStart();
    
    this.printResults();
  }

  async testGameCreation() {
    console.log('Test: Game Creation');
    const start = Date.now();
    
    await this.sendCommand('/create');
    await this.waitForMessage(5000);
    
    const messages = await this.getRecentMessages();
    const hasExactTime = messages.some(m => 
      m.text.includes('Starts at') && /\d{2}:\d{2}/.test(m.text)
    );
    
    this.results.push({
      test: 'Game Creation',
      passed: hasExactTime,
      time: Date.now() - start
    });
  }

  async testJoinBuffering() {
    console.log('Test: Join Buffering');
    const start = Date.now();
    
    // Simulate 5 users joining
    for (let i = 1; i <= 5; i++) {
      await this.sendCommand('/join', `User${i}`);
      await this.wait(500);
    }
    
    // Wait for buffer flush
    await this.wait(6000);
    
    const messages = await this.getRecentMessages();
    const bufferedMsg = messages.find(m => 
      m.text.includes('joined!') && m.text.includes('User1')
    );
    
    this.results.push({
      test: 'Join Buffering',
      passed: !!bufferedMsg,
      time: Date.now() - start
    });
  }

  async testMessageThrottling() {
    console.log('Test: Message Throttling');
    const start = Date.now();
    
    // Try joining when already in game
    for (let i = 0; i < 5; i++) {
      await this.sendCommand('/join');
      await this.wait(1000);
    }
    
    const messages = await this.getRecentMessages();
    const alreadyJoined = messages.filter(m => 
      m.text.includes('Already in game')
    );
    
    this.results.push({
      test: 'Message Throttling',
      passed: alreadyJoined.length === 1,
      time: Date.now() - start
    });
  }

  async testGameStart() {
    console.log('Test: Game Start');
    const start = Date.now();
    
    // Wait for game to start
    await this.waitForMessage(60000, 'GAME STARTED!');
    
    const messages = await this.getRecentMessages();
    const startMsg = messages.find(m => 
      m.text.includes('GAME STARTED!') && 
      m.text.includes('Player Numbers:')
    );
    
    this.results.push({
      test: 'Game Start',
      passed: !!startMsg,
      time: Date.now() - start
    });
  }

  // Helper methods
  async sendCommand(cmd, username = 'Tester') {
    // Simulate sending command
    console.log(`Sending: ${cmd} as ${username}`);
  }

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitForMessage(timeout, containing = null) {
    // Wait for specific message
  }

  async getRecentMessages() {
    // Get recent messages from chat
    return [];
  }

  printResults() {
    console.log('\n=== Test Results ===');
    this.results.forEach(r => {
      const status = r.passed ? '✅' : '❌';
      console.log(`${status} ${r.test} (${r.time}ms)`);
    });
    
    const passed = this.results.filter(r => r.passed).length;
    console.log(`\nTotal: ${passed}/${this.results.length} passed`);
  }
}

// Run tests
const tester = new BotTester();
tester.runTests();
```

## Manual Testing Checklist

### Pre-Deployment
- [ ] Test in dedicated test group
- [ ] Verify all commands work
- [ ] Check message formatting
- [ ] Confirm timer accuracy
- [ ] Test with multiple concurrent players

### During Deployment
- [ ] Monitor logs for errors
- [ ] Watch message frequency
- [ ] Check game completion rate
- [ ] Verify no rate limit loops
- [ ] Confirm player satisfaction

### Post-Deployment
- [ ] Analyze 24-hour logs
- [ ] Calculate message reduction percentage
- [ ] Review any error patterns
- [ ] Collect user feedback
- [ ] Plan further optimizations

## Monitoring Commands

```bash
# Real-time monitoring
tail -f bot.log | grep -E "(ERROR|WARN|rate|throttle)"

# Message frequency
watch -n 5 'grep -c "Sending message" bot.log | tail -1'

# Game success rate
echo "Games started: $(grep -c "GAME STARTED" bot.log)"
echo "Games scheduled: $(grep -c "scheduled to start" bot.log)"

# Throttle effectiveness
grep "Throttled" bot.log | awk '{print $3}' | sort | uniq -c

# Rate limit incidents
grep -c "429" bot.log
```

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Message Reduction | >50% | Compare logs before/after |
| Game Start Success | 100% | Games started / scheduled |
| Rate Limit Recovery | <60s | Time between limit and recovery |
| Throttle Hit Rate | <20% | Throttled / total attempts |
| User Complaints | 0 | Feedback monitoring |

## Rollback Criteria

Rollback if:
- Game start success rate <95%
- Message volume increases
- Rate limit loops detected
- Multiple user complaints
- Critical errors in logs