const axios = require('axios');
const { performance } = require('perf_hooks');
const EventEmitter = require('events');
const os = require('os');

class StressTestResults {
  constructor() {
    this.results = {
      successfulRequests: 0,
      failedRequests: 0,
      totalRequests: 0,
      startTime: 0,
      endTime: 0,
      duration: 0,
      responseTimes: [],
      errors: [],
      statusCodes: {},
      throughput: 0,
      avgResponseTime: 0,
      minResponseTime: Number.MAX_VALUE,
      maxResponseTime: 0,
      percentiles: {}
    };
  }

  addResult(success, responseTime, statusCode, error = null) {
    this.results.totalRequests++;
    
    if (success) {
      this.results.successfulRequests++;
    } else {
      this.results.failedRequests++;
      if (error) {
        this.results.errors.push({
          message: error.message,
          code: error.code,
          timestamp: new Date().toISOString()
        });
      }
    }

    this.results.responseTimes.push(responseTime);
    this.results.statusCodes[statusCode] = (this.results.statusCodes[statusCode] || 0) + 1;
    
    if (responseTime < this.results.minResponseTime) {
      this.results.minResponseTime = responseTime;
    }
    if (responseTime > this.results.maxResponseTime) {
      this.results.maxResponseTime = responseTime;
    }
  }

  calculateStats() {
    const sorted = [...this.results.responseTimes].sort((a, b) => a - b);
    const total = sorted.reduce((sum, time) => sum + time, 0);
    
    this.results.avgResponseTime = total / sorted.length;
    this.results.duration = this.results.endTime - this.results.startTime;
    this.results.throughput = (this.results.totalRequests / this.results.duration) * 1000;
    
    // Calculate percentiles
    this.results.percentiles = {
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  generateReport() {
    this.calculateStats();
    
    const report = `
=====================================
       STRESS TEST REPORT
=====================================
Test Duration: ${(this.results.duration / 1000).toFixed(2)}s
Total Requests: ${this.results.totalRequests}
Successful: ${this.results.successfulRequests} (${((this.results.successfulRequests / this.results.totalRequests) * 100).toFixed(2)}%)
Failed: ${this.results.failedRequests} (${((this.results.failedRequests / this.results.totalRequests) * 100).toFixed(2)}%)

Response Times:
  Average: ${this.results.avgResponseTime.toFixed(2)}ms
  Min: ${this.results.minResponseTime.toFixed(2)}ms
  Max: ${this.results.maxResponseTime.toFixed(2)}ms
  
Percentiles:
  50%: ${this.results.percentiles.p50?.toFixed(2)}ms
  75%: ${this.results.percentiles.p75?.toFixed(2)}ms
  90%: ${this.results.percentiles.p90?.toFixed(2)}ms
  95%: ${this.results.percentiles.p95?.toFixed(2)}ms
  99%: ${this.results.percentiles.p99?.toFixed(2)}ms

Throughput: ${this.results.throughput.toFixed(2)} req/s

Status Codes:
${Object.entries(this.results.statusCodes).map(([code, count]) => `  ${code}: ${count}`).join('\n')}

${this.results.errors.length > 0 ? `\nErrors (first 10):\n${this.results.errors.slice(0, 10).map(e => `  - ${e.message}`).join('\n')}` : ''}
=====================================
`;
    return report;
  }
}

class LotteryBotStressTester extends EventEmitter {
  constructor(config) {
    super();
    this.config = {
      apiUrl: config.apiUrl || 'http://localhost:3001',
      apiPrefix: config.apiPrefix || '/api/v1',
      concurrentUsers: config.concurrentUsers || 50,
      testDuration: config.testDuration || 30000, // 30 seconds
      requestDelay: config.requestDelay || 100, // delay between requests per user
      rampUpTime: config.rampUpTime || 5000, // 5 seconds to ramp up all users
      ...config
    };
    
    this.results = new StressTestResults();
    this.activeRequests = 0;
    this.shouldStop = false;
  }

  async generateTestWallet() {
    // Generate random wallet address for testing
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let wallet = '';
    for (let i = 0; i < 44; i++) {
      wallet += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return wallet;
  }

  async generateAuthMessage(walletAddress) {
    const timestamp = Date.now();
    const nonce = Math.random().toString(36).substring(7);
    
    return {
      message: `Please sign this message to authenticate with Raffle Hub v4.\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}\n\nThis signature will not trigger any blockchain transaction or cost any gas fees.`,
      timestamp
    };
  }

  async simulateUserJoin(userId) {
    const walletAddress = await this.generateTestWallet();
    const startTime = performance.now();
    let statusCode = 0;
    
    try {
      // Step 1: Get auth challenge
      const challengeResponse = await axios.post(
        `${this.config.apiUrl}${this.config.apiPrefix}/auth/challenge`,
        { walletAddress },
        {
          timeout: 10000,
          validateStatus: () => true
        }
      );
      
      statusCode = challengeResponse.status;
      
      if (challengeResponse.status !== 200) {
        throw new Error(`Challenge failed: ${challengeResponse.status}`);
      }
      
      // Step 2: Simulate wallet signature (mock)
      const { message, timestamp } = challengeResponse.data.data;
      const mockSignature = 'mock_signature_' + Math.random().toString(36).substring(7);
      
      // Small delay to simulate wallet signing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Step 3: Login with signature
      const loginResponse = await axios.post(
        `${this.config.apiUrl}${this.config.apiPrefix}/auth/login`,
        {
          walletAddress,
          signature: mockSignature,
          message,
          timestamp
        },
        {
          timeout: 10000,
          validateStatus: () => true
        }
      );
      
      statusCode = loginResponse.status;
      const responseTime = performance.now() - startTime;
      
      if (loginResponse.status === 200) {
        this.results.addResult(true, responseTime, statusCode);
        this.emit('requestSuccess', { userId, responseTime, walletAddress });
      } else {
        this.results.addResult(false, responseTime, statusCode, 
          new Error(`Login failed: ${loginResponse.status}`));
        this.emit('requestFailed', { userId, statusCode, responseTime });
      }
      
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.results.addResult(false, responseTime, statusCode || 0, error);
      this.emit('requestError', { userId, error: error.message });
    }
  }

  async runUserSimulation(userId) {
    this.emit('userStarted', { userId });
    
    while (!this.shouldStop) {
      this.activeRequests++;
      
      try {
        await this.simulateUserJoin(userId);
      } catch (error) {
        this.emit('userError', { userId, error: error.message });
      } finally {
        this.activeRequests--;
      }
      
      // Random delay between requests for this user
      const delay = this.config.requestDelay + Math.random() * this.config.requestDelay;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.emit('userStopped', { userId });
  }

  async startTest() {
    console.log(`
🚀 Starting Lottery Bot Stress Test
===================================
Target URL: ${this.config.apiUrl}
Concurrent Users: ${this.config.concurrentUsers}
Test Duration: ${this.config.testDuration / 1000}s
Ramp-up Time: ${this.config.rampUpTime / 1000}s
===================================
`);

    this.results.results.startTime = performance.now();
    this.shouldStop = false;
    
    const users = [];
    const rampUpDelay = this.config.rampUpTime / this.config.concurrentUsers;
    
    // Progress tracking
    let completed = 0;
    this.on('requestSuccess', () => {
      completed++;
      if (completed % 100 === 0) {
        console.log(`✓ Completed ${completed} requests...`);
      }
    });
    
    // Start ramping up users
    for (let i = 0; i < this.config.concurrentUsers; i++) {
      users.push(this.runUserSimulation(i));
      
      if (i % 10 === 0) {
        console.log(`🚶 Ramping up... ${i + 1}/${this.config.concurrentUsers} users`);
      }
      
      await new Promise(resolve => setTimeout(resolve, rampUpDelay));
    }
    
    console.log('✅ All users active, running test...');
    
    // Run for specified duration
    await new Promise(resolve => setTimeout(resolve, this.config.testDuration));
    
    // Stop test
    console.log('\n🛑 Stopping test...');
    this.shouldStop = true;
    
    // Wait for active requests to complete
    while (this.activeRequests > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.results.results.endTime = performance.now();
    
    // Generate and display report
    const report = this.results.generateReport();
    console.log(report);
    
    return this.results;
  }

  async runLoadScenarios() {
    const scenarios = [
      {
        name: 'Light Load',
        concurrentUsers: 10,
        testDuration: 15000
      },
      {
        name: 'Normal Load',
        concurrentUsers: 25,
        testDuration: 20000
      },
      {
        name: 'Heavy Load',
        concurrentUsers: 50,
        testDuration: 30000
      },
      {
        name: 'Stress Test',
        concurrentUsers: 100,
        testDuration: 20000
      },
      {
        name: 'Spike Test',
        concurrentUsers: 150,
        testDuration: 10000,
        rampUpTime: 2000
      }
    ];
    
    console.log(`
🎯 Running Multiple Load Scenarios
===================================
`);
    
    const allResults = [];
    
    for (const scenario of scenarios) {
      console.log(`\n📊 Running Scenario: ${scenario.name}`);
      console.log(`   Users: ${scenario.concurrentUsers}, Duration: ${scenario.testDuration / 1000}s`);
      
      this.config = { ...this.config, ...scenario };
      this.results = new StressTestResults();
      
      await this.startTest();
      
      allResults.push({
        scenario: scenario.name,
        results: { ...this.results.results }
      });
      
      // Cool down between scenarios
      console.log('\n⏸️  Cooling down for 10 seconds...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    // Summary report
    console.log(`
=====================================
    SCENARIO COMPARISON SUMMARY
=====================================`);
    
    for (const result of allResults) {
      const r = result.results;
      console.log(`
${result.scenario}:
  Success Rate: ${((r.successfulRequests / r.totalRequests) * 100).toFixed(2)}%
  Avg Response: ${r.avgResponseTime.toFixed(2)}ms
  Throughput: ${r.throughput.toFixed(2)} req/s
  P95 Response: ${r.percentiles.p95?.toFixed(2)}ms`);
    }
    
    return allResults;
  }

  async testRateLimiting() {
    console.log(`
🔒 Testing Rate Limiting
===================================
`);
    
    const results = {
      blocked: 0,
      passed: 0,
      totalAttempts: 200
    };
    
    const walletAddress = await this.generateTestWallet();
    
    // Rapid fire requests from same wallet
    const promises = [];
    for (let i = 0; i < results.totalAttempts; i++) {
      promises.push(
        axios.post(
          `${this.config.apiUrl}${this.config.apiPrefix}/auth/challenge`,
          { walletAddress },
          { validateStatus: () => true }
        ).then(response => {
          if (response.status === 429) {
            results.blocked++;
          } else {
            results.passed++;
          }
        })
      );
    }
    
    await Promise.all(promises);
    
    console.log(`
Rate Limiting Results:
  Total Attempts: ${results.totalAttempts}
  Passed: ${results.passed}
  Blocked: ${results.blocked} (${((results.blocked / results.totalAttempts) * 100).toFixed(2)}%)
`);
    
    return results;
  }

  async testDatabaseConnectionPool() {
    console.log(`
🗄️  Testing Database Connection Pool
===================================
`);
    
    // Test with extreme concurrent connections
    this.config.concurrentUsers = 200;
    this.config.testDuration = 10000;
    this.config.requestDelay = 0; // No delay
    
    await this.startTest();
  }
}

// Monitor system resources during test
function monitorResources() {
  const interval = setInterval(() => {
    const usage = process.memoryUsage();
    const cpus = os.cpus();
    const avgLoad = os.loadavg()[0];
    
    console.log(`
📊 System Resources:
  Memory: ${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB / ${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB
  CPU Load: ${avgLoad.toFixed(2)}
  Active Handles: ${process._getActiveHandles().length}
`);
  }, 5000);
  
  return () => clearInterval(interval);
}

// Main test runner
async function runStressTests() {
  const tester = new LotteryBotStressTester({
    apiUrl: process.env.API_URL || 'http://localhost:3001',
    concurrentUsers: parseInt(process.env.CONCURRENT_USERS) || 50,
    testDuration: parseInt(process.env.TEST_DURATION) || 30000
  });
  
  const stopMonitoring = monitorResources();
  
  try {
    // Run different test scenarios
    console.log('🏁 Starting Comprehensive Stress Tests\n');
    
    // Test 1: Basic stress test
    await tester.startTest();
    
    // Test 2: Rate limiting
    await tester.testRateLimiting();
    
    // Test 3: Multiple scenarios
    await tester.runLoadScenarios();
    
    // Test 4: Database connection pool stress
    await tester.testDatabaseConnectionPool();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    stopMonitoring();
    process.exit(0);
  }
}

// Export for use as module
module.exports = {
  LotteryBotStressTester,
  StressTestResults
};

// Run if called directly
if (require.main === module) {
  runStressTests();
}