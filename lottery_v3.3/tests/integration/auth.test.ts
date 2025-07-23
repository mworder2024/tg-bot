import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { AuthService } from '../../src/services/auth/auth.service';
import { SIWSService } from '../../src/services/auth/siws.service';
import { JWTService } from '../../src/services/auth/jwt.service';
import { logger } from '../../src/utils/structured-logger';
import { createTestApp } from '../utils/test-app';
import { createTestDatabase, cleanupTestDatabase } from '../utils/test-db';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey, Keypair } from '@solana/web3.js';

describe('Authentication System Integration Tests', () => {
  let app: any;
  let db: Pool;
  let redis: Redis;
  let authService: AuthService;
  let siwsService: SIWSService;
  let jwtService: JWTService;
  let testWallet: Keypair;

  beforeAll(async () => {
    // Setup test database and Redis
    db = await createTestDatabase();
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      db: 1 // Use separate database for tests
    });

    // Initialize services
    authService = new AuthService(db, redis, logger, 'test-jwt-secret');
    siwsService = new SIWSService(db, redis, logger);
    jwtService = new JWTService(db, redis, logger, 'test-jwt-secret');

    // Create test Solana wallet
    testWallet = Keypair.generate();

    // Setup test app
    app = await createTestApp(db, redis);
  });

  afterAll(async () => {
    await redis.quit();
    await cleanupTestDatabase(db);
  });

  beforeEach(async () => {
    // Clear test data before each test
    await redis.flushdb();
    await db.query('DELETE FROM auth_audit_logs');
    await db.query('DELETE FROM user_sessions');
    await db.query('DELETE FROM siws_challenges');
    await db.query('DELETE FROM user_profiles');
    await db.query('DELETE FROM user_roles');
    await db.query('DELETE FROM users');
  });

  describe('SIWS Authentication Flow', () => {
    it('should generate SIWS challenge', async () => {
      const address = testWallet.publicKey.toString();
      
      const response = await request(app)
        .post('/api/v2/auth/challenge')
        .send({ address })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.address).toBe(address);
      expect(response.body.data.message).toContain(address);
      expect(response.body.data.nonce).toBeTruthy();
      expect(response.body.data.domain).toBeTruthy();
    });

    it('should verify valid SIWS signature and create user', async () => {
      const address = testWallet.publicKey.toString();
      
      // Generate challenge
      const challenge = await siwsService.generateChallenge(
        address,
        'test-domain.com',
        'http://test-domain.com'
      );

      // Sign message
      const messageBytes = new TextEncoder().encode(challenge.message);
      const signature = bs58.encode(nacl.sign.detached(messageBytes, testWallet.secretKey));

      // Verify signature
      const response = await request(app)
        .post('/api/v2/auth/verify')
        .send({
          message: challenge.message,
          signature
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeTruthy();
      expect(response.body.data.user.walletAddress).toBe(address);
      expect(response.body.data.user.walletVerified).toBe(true);
      expect(response.body.data.token.accessToken).toBeTruthy();
      expect(response.body.data.token.refreshToken).toBeTruthy();

      // Verify user was created in database
      const userResult = await db.query('SELECT * FROM users WHERE wallet_address = $1', [address]);
      expect(userResult.rows.length).toBe(1);
      expect(userResult.rows[0].wallet_verified).toBe(true);
    });

    it('should reject invalid SIWS signature', async () => {
      const address = testWallet.publicKey.toString();
      
      // Generate challenge
      const challenge = await siwsService.generateChallenge(
        address,
        'test-domain.com',
        'http://test-domain.com'
      );

      // Use invalid signature
      const invalidSignature = bs58.encode(Buffer.alloc(64, 0));

      const response = await request(app)
        .post('/api/v2/auth/verify')
        .send({
          message: challenge.message,
          signature: invalidSignature
        })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('should reject expired SIWS challenge', async () => {
      const address = testWallet.publicKey.toString();
      
      // Generate challenge and manually expire it
      const challenge = await siwsService.generateChallenge(
        address,
        'test-domain.com',
        'http://test-domain.com'
      );

      // Mark challenge as expired in database
      await db.query(
        'UPDATE siws_challenges SET expiration_time = NOW() - INTERVAL \'1 hour\' WHERE nonce = $1',
        [challenge.nonce]
      );

      // Try to verify with valid signature
      const messageBytes = new TextEncoder().encode(challenge.message);
      const signature = bs58.encode(nacl.sign.detached(messageBytes, testWallet.secretKey));

      await request(app)
        .post('/api/v2/auth/verify')
        .send({
          message: challenge.message,
          signature
        })
        .expect(500); // Should throw error about expired challenge
    });
  });

  describe('Platform Authentication Flow', () => {
    it('should authenticate Telegram user', async () => {
      const response = await request(app)
        .post('/api/v2/auth/login')
        .send({
          platform: 'telegram',
          platformId: '123456789',
          username: 'testuser',
          metadata: { firstName: 'Test', lastName: 'User' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.telegramId).toBe('123456789');
      expect(response.body.data.user.username).toBe('testuser');
      expect(response.body.data.token.accessToken).toBeTruthy();

      // Verify user was created
      const userResult = await db.query('SELECT * FROM users WHERE telegram_id = $1', ['123456789']);
      expect(userResult.rows.length).toBe(1);
    });

    it('should authenticate Discord user', async () => {
      const response = await request(app)
        .post('/api/v2/auth/login')
        .send({
          platform: 'discord',
          platformId: '987654321',
          username: 'discorduser',
          metadata: { discriminator: '1234' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.discordId).toBe('987654321');
      expect(response.body.data.user.username).toBe('discorduser');
    });

    it('should reject banned user', async () => {
      // Create banned user
      const userResult = await db.query(
        `INSERT INTO users (telegram_id, username, is_banned)
         VALUES ($1, $2, true) RETURNING id`,
        ['123456789', 'banneduser']
      );

      const response = await request(app)
        .post('/api/v2/auth/login')
        .send({
          platform: 'telegram',
          platformId: '123456789',
          username: 'banneduser'
        })
        .expect(403);

      expect(response.body.error.code).toBe('USER_BANNED');
    });
  });

  describe('JWT Token Management', () => {
    let userToken: string;
    let refreshToken: string;
    let userId: string;

    beforeEach(async () => {
      // Create test user and get tokens
      const response = await request(app)
        .post('/api/v2/auth/login')
        .send({
          platform: 'telegram',
          platformId: '123456789',
          username: 'testuser'
        });

      userToken = response.body.data.token.accessToken;
      refreshToken = response.body.data.token.refreshToken;
      userId = response.body.data.user.id;
    });

    it('should authenticate with valid JWT token', async () => {
      const response = await request(app)
        .get('/api/v2/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.id).toBe(userId);
    });

    it('should reject expired token', async () => {
      // Create expired token
      const expiredPayload = await jwtService.verifyAccessToken(userToken);
      const expiredToken = await jwtService.generateTokens({
        ...expiredPayload!,
        // Mock expired token by manipulating session
      });

      // Manually expire session in database
      await db.query(
        'UPDATE user_sessions SET expires_at = NOW() - INTERVAL \'1 hour\' WHERE user_id = $1',
        [userId]
      );

      await request(app)
        .get('/api/v2/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(401);
    });

    it('should refresh access token with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/v2/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.token.accessToken).toBeTruthy();
      expect(response.body.data.token.refreshToken).toBeTruthy();
      expect(response.body.data.token.accessToken).not.toBe(userToken);
    });

    it('should logout and invalidate token', async () => {
      // Logout
      await request(app)
        .post('/api/v2/auth/logout')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      // Token should be invalid after logout
      await request(app)
        .get('/api/v2/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(401);
    });
  });

  describe('Profile Management', () => {
    let userToken: string;
    let userId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/v2/auth/login')
        .send({
          platform: 'telegram',
          platformId: '123456789',
          username: 'testuser'
        });

      userToken = response.body.data.token.accessToken;
      userId = response.body.data.user.id;
    });

    it('should update user profile', async () => {
      const profileData = {
        displayName: 'Test User',
        bio: 'This is a test user',
        country: 'US',
        language: 'en',
        timezone: 'America/New_York',
        preferences: { theme: 'dark' }
      };

      const response = await request(app)
        .put('/api/v2/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send(profileData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.displayName).toBe(profileData.displayName);

      // Verify profile was created in database
      const profileResult = await db.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
      expect(profileResult.rows.length).toBe(1);
      expect(profileResult.rows[0].bio).toBe(profileData.bio);
    });

    it('should link wallet to account', async () => {
      const address = testWallet.publicKey.toString();
      
      // Generate challenge and sign
      const challenge = await siwsService.generateChallenge(
        address,
        'test-domain.com',
        'http://test-domain.com'
      );

      const messageBytes = new TextEncoder().encode(challenge.message);
      const signature = bs58.encode(nacl.sign.detached(messageBytes, testWallet.secretKey));

      const response = await request(app)
        .post('/api/v2/auth/link-wallet')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ address, signature })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.walletAddress).toBe(address);
      expect(response.body.data.user.walletVerified).toBe(true);
    });

    it('should unlink wallet from account', async () => {
      // First link a wallet
      const address = testWallet.publicKey.toString();
      await db.query(
        'UPDATE users SET wallet_address = $1, wallet_verified = true WHERE id = $2',
        [address, userId]
      );

      const response = await request(app)
        .post('/api/v2/auth/unlink-wallet')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.walletAddress).toBeNull();
      expect(response.body.data.user.walletVerified).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on auth endpoints', async () => {
      const address = testWallet.publicKey.toString();

      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/v2/auth/challenge')
          .send({ address })
          .expect(200);
      }

      // Next request should be rate limited
      const response = await request(app)
        .post('/api/v2/auth/challenge')
        .send({ address })
        .expect(429);

      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('Security Features', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/api/v2/auth/profile')
        .expect(401); // No auth, but should still have headers

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should audit authentication events', async () => {
      await request(app)
        .post('/api/v2/auth/login')
        .send({
          platform: 'telegram',
          platformId: '123456789',
          username: 'testuser'
        })
        .expect(200);

      // Check audit log
      const auditResult = await db.query(
        'SELECT * FROM auth_audit_logs WHERE action = $1',
        ['siws_login']
      );

      expect(auditResult.rows.length).toBeGreaterThan(0);
      expect(auditResult.rows[0].success).toBe(true);
    });
  });
});