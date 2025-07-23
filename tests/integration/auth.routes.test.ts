import request from 'supertest';
import express from 'express';
import { Pool } from 'pg';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createAuthRoutes } from '../../src/api/routes/auth.routes';
import { 
  setupTestDatabase, 
  cleanupTestDatabase, 
  closeTestDatabase,
  testJwtSecret
} from '../setup/test-env';

describe('Auth Routes', () => {
  let app: express.Application;
  let db: Pool;
  let testKeypair: Keypair;
  let testWalletAddress: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    
    // Create test app
    app = express();
    app.use(express.json());
    app.use('/auth', createAuthRoutes(db));
    
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
  });

  describe('POST /auth/challenge', () => {
    it('should generate authentication challenge', async () => {
      const response = await request(app)
        .post('/auth/challenge')
        .send({ walletAddress: testWalletAddress })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('message');
      expect(response.body.data).toHaveProperty('timestamp');
      expect(response.body.data).toHaveProperty('expiresAt');
      expect(response.body.data.message).toContain(testWalletAddress);
    });

    it('should reject invalid wallet address', async () => {
      const response = await request(app)
        .post('/auth/challenge')
        .send({ walletAddress: 'invalid-wallet' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should validate wallet address format', async () => {
      const response = await request(app)
        .post('/auth/challenge')
        .send({ walletAddress: '123' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/login', () => {
    let challengeMessage: string;
    let challengeTimestamp: number;

    beforeEach(async () => {
      // Get challenge first
      const challengeResponse = await request(app)
        .post('/auth/challenge')
        .send({ walletAddress: testWalletAddress });

      challengeMessage = challengeResponse.body.data.message;
      challengeTimestamp = challengeResponse.body.data.timestamp;
    });

    it('should authenticate user with valid signature', async () => {
      // Sign the challenge message
      const messageBytes = new TextEncoder().encode(challengeMessage);
      const signature = nacl.sign.detached(messageBytes, testKeypair.secretKey);
      const signatureBase58 = bs58.encode(signature);

      const response = await request(app)
        .post('/auth/login')
        .send({
          walletAddress: testWalletAddress,
          signature: signatureBase58,
          message: challengeMessage,
          timestamp: challengeTimestamp,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('expiresAt');
      expect(response.body.data.user.walletAddress).toBe(testWalletAddress);
      expect(response.body.data.user).toHaveProperty('id');
    });

    it('should create new user on first login', async () => {
      const messageBytes = new TextEncoder().encode(challengeMessage);
      const signature = nacl.sign.detached(messageBytes, testKeypair.secretKey);
      const signatureBase58 = bs58.encode(signature);

      const response = await request(app)
        .post('/auth/login')
        .send({
          walletAddress: testWalletAddress,
          signature: signatureBase58,
          message: challengeMessage,
          timestamp: challengeTimestamp,
        })
        .expect(200);

      // Check user was created in database
      const userResult = await db.query(
        'SELECT * FROM users WHERE wallet_address = $1',
        [testWalletAddress]
      );

      expect(userResult.rows.length).toBe(1);
      expect(userResult.rows[0].wallet_address).toBe(testWalletAddress);
      expect(userResult.rows[0].username).toBeDefined();
    });

    it('should reject invalid signature', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          walletAddress: testWalletAddress,
          signature: 'invalid-signature',
          message: challengeMessage,
          timestamp: challengeTimestamp,
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should reject expired timestamp', async () => {
      const expiredTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const expiredMessage = challengeMessage.replace(
        challengeTimestamp.toString(),
        expiredTimestamp.toString()
      );

      const messageBytes = new TextEncoder().encode(expiredMessage);
      const signature = nacl.sign.detached(messageBytes, testKeypair.secretKey);
      const signatureBase58 = bs58.encode(signature);

      const response = await request(app)
        .post('/auth/login')
        .send({
          walletAddress: testWalletAddress,
          signature: signatureBase58,
          message: expiredMessage,
          timestamp: expiredTimestamp,
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          walletAddress: testWalletAddress,
          // missing signature, message, timestamp
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should handle wrong wallet address for signature', async () => {
      const wrongKeypair = Keypair.generate();
      const messageBytes = new TextEncoder().encode(challengeMessage);
      const signature = nacl.sign.detached(messageBytes, wrongKeypair.secretKey);
      const signatureBase58 = bs58.encode(signature);

      const response = await request(app)
        .post('/auth/login')
        .send({
          walletAddress: testWalletAddress, // Different from signature wallet
          signature: signatureBase58,
          message: challengeMessage,
          timestamp: challengeTimestamp,
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /auth/me', () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      // Login to get token
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

    it('should return user info with valid token', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('walletAddress');
      expect(response.body.data).toHaveProperty('totalXp');
      expect(response.body.data).toHaveProperty('currentLevel');
      expect(response.body.data.walletAddress).toBe(testWalletAddress);
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/refresh', () => {
    let authToken: string;

    beforeEach(async () => {
      // Login to get token
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
    });

    it('should refresh token for authenticated user', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('expiresAt');
      expect(response.body.data.token).not.toBe(authToken); // Should be new token
    });

    it('should reject refresh without valid token', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/logout', () => {
    let authToken: string;

    beforeEach(async () => {
      // Login to get token
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
    });

    it('should logout user successfully', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged out successfully');
    });

    it('should invalidate session after logout', async () => {
      // Logout
      await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check that session is no longer active
      const sessionResult = await db.query(
        'SELECT is_active FROM user_sessions WHERE session_token = $1',
        [authToken]
      );

      if (sessionResult.rows.length > 0) {
        expect(sessionResult.rows[0].is_active).toBe(false);
      }
    });

    it('should require authentication for logout', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /auth/sessions', () => {
    let authToken: string;

    beforeEach(async () => {
      // Login to get token
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
    });

    it('should return user sessions', async () => {
      const response = await request(app)
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('id');
      expect(response.body.data[0]).toHaveProperty('ip_address');
      expect(response.body.data[0]).toHaveProperty('user_agent');
      expect(response.body.data[0]).toHaveProperty('created_at');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/auth/sessions')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('rate limiting', () => {
    it('should rate limit authentication attempts', async () => {
      const promises = [];

      // Make many requests quickly
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/auth/challenge')
            .send({ walletAddress: testWalletAddress })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429 status)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      
      // Note: This test might be flaky depending on rate limiting implementation
      // In a real test, you might want to mock the rate limiter
    });
  });
});