# Lottery Bot Stress Testing Guide

This guide explains how to stress test the lottery bot to simulate multiple users joining simultaneously.

## 🚀 Quick Start

```bash
# Run the automated stress test
./tests/run-stress-test.sh

# Quick test (25 users, 10 seconds)
./tests/run-stress-test.sh --quick

# Custom configuration
CONCURRENT_USERS=100 TEST_DURATION=60000 ./tests/run-stress-test.sh
```

## 📊 Test Scenarios

### 1. API Stress Test (`stress-test.js`)

Tests the REST API endpoints with configurable load:

- **Light Load**: 10 concurrent users
- **Normal Load**: 25 concurrent users  
- **Heavy Load**: 50 concurrent users
- **Stress Test**: 100 concurrent users
- **Spike Test**: 150 concurrent users (rapid ramp-up)

Features tested:
- Authentication flow (`/auth/challenge` → `/auth/login`)
- Rate limiting enforcement
- Database connection pooling
- Response time percentiles (P50, P75, P90, P95, P99)
- Throughput measurement

### 2. Telegram Bot Stress Test (`telegram-bot-stress-test.js`)

Simulates Telegram bot interactions:

- Multiple users sending commands simultaneously
- Callback query handling
- Message processing performance
- Database query load testing
- Burst scenario simulation

Commands tested:
- `/start`, `/join`, `/wallet`
- `/leaderboard`, `/stats`, `/help`
- `/buy`, `/tickets`, `/profile`
- Inline keyboard callbacks

## 🛠️ Configuration

### Environment Variables

```bash
# API Configuration
API_URL=http://localhost:3001          # API server URL
CONCURRENT_USERS=50                     # Number of simultaneous users
TEST_DURATION=30000                     # Test duration in milliseconds

# Telegram Bot Configuration  
BOT_TOKEN=your-bot-token               # For live bot testing
WEBHOOK_URL=http://localhost:3002      # Webhook endpoint
TEST_WEBHOOK=true                       # Enable webhook testing
```

### Test Parameters

```javascript
const config = {
  concurrentUsers: 50,      // Number of virtual users
  testDuration: 30000,      // Test duration (ms)
  requestDelay: 100,        // Delay between requests (ms)
  rampUpTime: 5000,         // Time to spawn all users (ms)
  maxRequestsPerMinute: 100 // Rate limit threshold
};
```

## 📈 Performance Metrics

The stress tests measure:

1. **Response Times**
   - Average, min, max
   - Percentiles (P50, P75, P90, P95, P99)

2. **Throughput**
   - Requests per second
   - Messages per second

3. **Success Rate**
   - Successful vs failed requests
   - Error distribution

4. **System Resources**
   - CPU usage
   - Memory consumption
   - Active connections

## 🔍 Running Individual Tests

### API Stress Test

```bash
# Basic test
node tests/stress-test.js

# With custom parameters
API_URL=https://api.example.com CONCURRENT_USERS=100 node tests/stress-test.js
```

### Telegram Bot Test

```bash
# Simulation mode (no real bot)
node tests/telegram-bot-stress-test.js

# Live bot testing
BOT_TOKEN=your-token node tests/telegram-bot-stress-test.js

# Webhook testing
TEST_WEBHOOK=true WEBHOOK_URL=http://localhost:3000/webhook node tests/telegram-bot-stress-test.js
```

## 📊 Interpreting Results

### Success Metrics
- **Success Rate > 95%**: System is healthy
- **Avg Response Time < 500ms**: Good performance
- **P95 < 1000ms**: Acceptable tail latency

### Warning Signs
- **Success Rate < 90%**: System overloaded
- **Response Time > 1000ms**: Performance issues
- **Many 429 errors**: Rate limiting too aggressive
- **Database errors**: Connection pool exhausted

## 🔧 Optimization Tips

Based on stress test results:

1. **Database Optimization**
   ```javascript
   // Increase connection pool
   const pool = new Pool({
     max: 50,  // Increase from default 20
     idleTimeoutMillis: 30000,
     connectionTimeoutMillis: 5000
   });
   ```

2. **Rate Limiting Adjustment**
   ```javascript
   const rateLimiter = rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 200,  // Increase limit
     skipSuccessfulRequests: true
   });
   ```

3. **Caching Implementation**
   ```javascript
   // Add Redis caching for frequent queries
   const cached = await redis.get(`leaderboard:${date}`);
   if (cached) return JSON.parse(cached);
   ```

4. **Connection Reuse**
   ```javascript
   // Enable keep-alive for HTTP connections
   const agent = new http.Agent({
     keepAlive: true,
     maxSockets: 100
   });
   ```

## 🚨 Common Issues

### "Too many connections" error
- Increase database `max_connections`
- Implement connection pooling
- Add query result caching

### High response times
- Add database indices
- Optimize heavy queries
- Implement pagination

### Rate limit errors
- Adjust rate limit thresholds
- Implement tiered limits by user type
- Add request queuing

## 📝 Sample Test Report

```
=====================================
       STRESS TEST REPORT
=====================================
Test Duration: 30.00s
Total Requests: 1500
Successful: 1425 (95.00%)
Failed: 75 (5.00%)

Response Times:
  Average: 245.67ms
  Min: 45.23ms
  Max: 2341.56ms
  
Percentiles:
  50%: 198.45ms
  75%: 289.67ms
  90%: 456.78ms
  95%: 678.90ms
  99%: 1234.56ms

Throughput: 50.00 req/s

Status Codes:
  200: 1425
  429: 50
  500: 25
=====================================
```

## 🔒 Security Considerations

When stress testing:

1. **Test in isolated environment**
   - Use development/staging servers
   - Avoid production systems

2. **Monitor resource usage**
   - Watch for memory leaks
   - Check file descriptor limits

3. **Clean up test data**
   - Remove test users
   - Clear test transactions

4. **Rate limit testing**
   - Respect actual limits
   - Test gradual load increase

## 🐛 Debugging

Enable debug logging:

```bash
# Verbose output
DEBUG=* node tests/stress-test.js

# Save results to file
node tests/stress-test.js > stress-test-results.log 2>&1
```

## 📚 Additional Resources

- [Artillery.io](https://artillery.io/) - Advanced load testing
- [K6](https://k6.io/) - Modern load testing tool
- [Grafana](https://grafana.com/) - Metrics visualization
- [Prometheus](https://prometheus.io/) - Metrics collection