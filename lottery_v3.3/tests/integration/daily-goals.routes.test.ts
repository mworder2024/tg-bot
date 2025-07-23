import request from 'supertest';
import express from 'express';
import { Pool } from 'pg';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createAuthRoutes } from '../../src/api/routes/auth.routes';
import { createDailyGoalsRoutes } from '../../src/api/routes/daily-goals.routes';
import { 
  setupTestDatabase, 
  cleanupTestDatabase, 
  closeTestDatabase,
  testJwtSecret
} from '../setup/test-env';

describe('Daily Goals Routes', () => {
  let app: express.Application;
  let db: Pool;
  let testKeypair: Keypair;
  let testWalletAddress: string;
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    
    // Create test app
    app = express();
    app.use(express.json());
    app.use('/auth', createAuthRoutes(db));
    app.use('/daily-goals', createDailyGoalsRoutes(db));
    
    // Create test wallet
    testKeypair = Keypair.generate();
    testWalletAddress = testKeypair.publicKey.toBase58();
    
    // Set JWT secret for tests
    process.env.JWT_SECRET = testJwtSecret;
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    
    // Login to get auth token
    const challengeResponse = await request(app)
      .post('/auth/challenge')
      .send({ walletAddress: testWalletAddress });

    const challengeMessage = challengeResponse.body.data.message;
    const challengeTimestamp = challengeResponse.body.data.timestamp;

    const messageBytes = new TextEncoder().encode(challengeMessage);
    const signature = nacl.sign.detached(messageBytes, testKeypair.secretKey);
    const signatureBase58 = bs58.encode(signature);

    const loginResponse = await request(app)
      .post('/auth/login')
      .send({
        walletAddress: testWalletAddress,
        signature: signatureBase58,
        message: challengeMessage,
        timestamp: challengeTimestamp,
      });

    authToken = loginResponse.body.data.token;
    userId = loginResponse.body.data.user.id;
  });

  describe('POST /daily-goals/check-in', () => {
    it('should process check-in successfully', async () => {
      const response = await request(app)
        .post('/daily-goals/check-in')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('currentStreak');
      expect(response.body.data).toHaveProperty('xpEarned');
      expect(response.body.data.currentStreak).toBe(1);
      expect(response.body.data.xpEarned).toBeGreaterThan(0);
    });

    it('should not allow duplicate check-ins', async () => {
      // First check-in
      await request(app)
        .post('/daily-goals/check-in')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Second check-in attempt
      const response = await request(app)
        .post('/daily-goals/check-in')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.success).toBe(false);
      expect(response.body.data.message).toContain('Already checked in today');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/daily-goals/check-in')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should track IP and user agent', async () => {
      const response = await request(app)
        .post('/daily-goals/check-in')
        .set('Authorization', `Bearer ${authToken}`)
        .set('User-Agent', 'Test User Agent')
        .expect(200);

      expect(response.body.success).toBe(true);

      // Check database for IP and user agent tracking
      const checkInResult = await db.query(
        'SELECT ip_address, user_agent FROM user_check_ins WHERE user_id = $1',
        [userId]
      );

      expect(checkInResult.rows.length).toBe(1);
      expect(checkInResult.rows[0].user_agent).toBe('Test User Agent');
    });
  });

  describe('GET /daily-goals/dashboard', () => {
    it('should return user dashboard', async () => {
      const response = await request(app)
        .get('/daily-goals/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('userId');
      expect(response.body.data).toHaveProperty('totalGoalsAvailable');
      expect(response.body.data).toHaveProperty('totalGoalsCompleted');
      expect(response.body.data).toHaveProperty('completionPercentage');
      expect(response.body.data).toHaveProperty('currentStreak');
      expect(response.body.data).toHaveProperty('goalProgress');
      expect(response.body.data.goalProgress).toBeInstanceOf(Array);
    });

    it('should return dashboard with updated progress after check-in', async () => {
      // Check-in first
      await request(app)
        .post('/daily-goals/check-in')
        .set('Authorization', `Bearer ${authToken}`);

      const response = await request(app)
        .get('/daily-goals/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.checkInCompleted).toBe(true);
      expect(response.body.data.currentStreak).toBe(1);
      expect(response.body.data.dailyXpEarned).toBeGreaterThan(0);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/daily-goals/dashboard')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /daily-goals/goals', () => {
    it('should return list of active goals', async () => {
      const response = await request(app)
        .get('/daily-goals/goals')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      const goal = response.body.data[0];
      expect(goal).toHaveProperty('id');
      expect(goal).toHaveProperty('name');
      expect(goal).toHaveProperty('description');
      expect(goal).toHaveProperty('goalType');
      expect(goal).toHaveProperty('requirementValue');
      expect(goal).toHaveProperty('rewardXp');
      expect(goal).toHaveProperty('isActive', true);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/daily-goals/goals')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /daily-goals/progress', () => {
    it('should update goal progress successfully', async () => {
      const response = await request(app)
        .post('/daily-goals/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          goalType: 'social_share',
          incrementAmount: 1,
          metadata: { platform: 'twitter' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('goalsUpdated');
      expect(response.body.data).toHaveProperty('goalsCompleted');
      expect(response.body.data).toHaveProperty('totalXpEarned');
      expect(response.body.data).toHaveProperty('completedGoalNames');
      expect(response.body.data.goalsUpdated).toBeGreaterThan(0);
    });

    it('should validate goal type', async () => {
      const response = await request(app)
        .post('/daily-goals/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          goalType: 'invalid_goal',
          incrementAmount: 1
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should validate increment amount', async () => {
      const response = await request(app)
        .post('/daily-goals/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          goalType: 'social_share',
          incrementAmount: 1000 // Too high
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/daily-goals/progress')
        .send({
          goalType: 'social_share',
          incrementAmount: 1
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should handle multiple goal updates correctly', async () => {
      // Update social share goal
      const socialResponse = await request(app)
        .post('/daily-goals/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ goalType: 'social_share', incrementAmount: 1 });

      // Update ticket purchase goal
      const ticketResponse = await request(app)
        .post('/daily-goals/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ goalType: 'ticket_purchase', incrementAmount: 1 });

      expect(socialResponse.body.data.goalsCompleted).toBeGreaterThan(0);
      expect(ticketResponse.body.data.goalsCompleted).toBeGreaterThan(0);
    });
  });

  describe('GET /daily-goals/streak', () => {
    it('should return current streak info', async () => {
      const response = await request(app)
        .get('/daily-goals/streak')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('currentStreak');
      expect(response.body.data).toHaveProperty('daysToNextMilestone');
      expect(response.body.data.currentStreak).toBe(0); // No check-ins yet
    });

    it('should update after check-in', async () => {
      // Check-in first
      await request(app)
        .post('/daily-goals/check-in')
        .set('Authorization', `Bearer ${authToken}`);

      const response = await request(app)
        .get('/daily-goals/streak')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.currentStreak).toBe(1);
      expect(response.body.data.daysToNextMilestone).toBe(6); // 7 - 1 = 6 days to weekly milestone
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/daily-goals/streak')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /daily-goals/leaderboard/streaks', () => {
    it('should return streak leaderboard', async () => {
      // Add some check-ins for current user
      await request(app)
        .post('/daily-goals/check-in')
        .set('Authorization', `Bearer ${authToken}`);

      const response = await request(app)
        .get('/daily-goals/leaderboard/streaks')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      
      if (response.body.data.length > 0) {
        const entry = response.body.data[0];
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('currentStreak');
        expect(entry).toHaveProperty('bestStreakEver');
        expect(entry).toHaveProperty('totalCheckins');
        expect(entry).toHaveProperty('streakRank');
      }
    });

    it('should respect limit parameter', async () => {
      const response = await request(app)
        .get('/daily-goals/leaderboard/streaks?limit=5')
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should validate limit parameter', async () => {
      const response = await request(app)
        .get('/daily-goals/leaderboard/streaks?limit=1000')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /daily-goals/claim-bonus', () => {
    beforeEach(async () => {
      // Complete all daily goals to be eligible for bonus
      const goals = ['social_share', 'ticket_purchase', 'twitter_post', 'referral', 'check_in'];
      
      for (const goalType of goals) {
        if (goalType === 'check_in') {
          await request(app)
            .post('/daily-goals/check-in')
            .set('Authorization', `Bearer ${authToken}`);
        } else {
          await request(app)
            .post('/daily-goals/progress')
            .set('Authorization', `Bearer ${authToken}`)
            .send({ goalType, incrementAmount: 1 });
        }
      }
    });

    it('should claim all-goals bonus when eligible', async () => {
      const response = await request(app)
        .post('/daily-goals/claim-bonus')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.success).toBe(true);
      expect(response.body.data.xpEarned).toBeGreaterThan(0);
    });

    it('should not allow claiming bonus twice', async () => {
      // First claim
      await request(app)
        .post('/daily-goals/claim-bonus')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Second claim attempt
      const response = await request(app)
        .post('/daily-goals/claim-bonus')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.success).toBe(false);
      expect(response.body.data.message).toContain('already claimed');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/daily-goals/claim-bonus')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /daily-goals/progress/history', () => {
    it('should return progress history', async () => {
      // Add some progress
      await request(app)
        .post('/daily-goals/check-in')
        .set('Authorization', `Bearer ${authToken}`);

      const response = await request(app)
        .get('/daily-goals/progress/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('startDate');
      expect(response.body.data).toHaveProperty('endDate');
      expect(response.body.data).toHaveProperty('summary');
      expect(response.body.data.summary).toBeInstanceOf(Array);
    });

    it('should validate date parameters', async () => {
      const response = await request(app)
        .get('/daily-goals/progress/history?startDate=invalid-date')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should validate limit parameter', async () => {
      const response = await request(app)
        .get('/daily-goals/progress/history?limit=100')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/daily-goals/progress/history')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /daily-goals/progress/:date', () => {
    it('should return progress for specific date', async () => {
      const today = new Date().toISOString().split('T')[0];
      
      const response = await request(app)
        .get(`/daily-goals/progress/${today}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('date');
      expect(response.body.data).toHaveProperty('progress');
      expect(response.body.data.progress).toBeInstanceOf(Array);
    });

    it('should validate date parameter', async () => {
      const response = await request(app)
        .get('/daily-goals/progress/invalid-date')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const today = new Date().toISOString().split('T')[0];
      
      const response = await request(app)
        .get(`/daily-goals/progress/${today}`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/daily-goals/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);
    });

    it('should handle missing required fields', async () => {
      const response = await request(app)
        .post('/daily-goals/progress')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should handle server errors gracefully', async () => {
      // This would test server error handling, but requires mocking database failures
      // In a real test environment, you might mock the database to throw errors
    });
  });
});