import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { logger } from '../../src/utils/logger';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Test database configuration
export const testDbConfig = {
  connectionString: process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/raffle_hub_test',
  ssl: false,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
};

// Test JWT secret
export const testJwtSecret = process.env.TEST_JWT_SECRET || 'test-jwt-secret-key-very-secure';

// Test Solana config
export const testSolanaConfig = {
  rpcUrl: process.env.TEST_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  programId: process.env.TEST_SOLANA_PROGRAM_ID || '11111111111111111111111111111112',
};

// Global test database pool
let testDb: Pool | null = null;

export function getTestDb(): Pool {
  if (!testDb) {
    testDb = new Pool(testDbConfig);
  }
  return testDb;
}

export async function setupTestDatabase(): Promise<Pool> {
  const db = getTestDb();
  
  try {
    // Test connection
    const client = await db.connect();
    client.release();
    logger.info('Test database connected successfully');
    
    // Setup test schema
    await setupTestSchema(db);
    
    return db;
  } catch (error) {
    logger.error('Test database setup failed:', error);
    throw error;
  }
}

export async function setupTestSchema(db: Pool): Promise<void> {
  // Create test schema
  await db.query('CREATE SCHEMA IF NOT EXISTS test');
  
  // Create test tables (simplified versions)
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_address VARCHAR(44) UNIQUE NOT NULL,
      username VARCHAR(30),
      display_name VARCHAR(50),
      email VARCHAR(255),
      bio TEXT,
      profile_image_url TEXT,
      is_verified BOOLEAN DEFAULT FALSE,
      is_admin BOOLEAN DEFAULT FALSE,
      total_xp BIGINT DEFAULT 0,
      current_level INTEGER DEFAULT 1,
      total_tickets_purchased INTEGER DEFAULT 0,
      total_amount_spent BIGINT DEFAULT 0,
      total_winnings BIGINT DEFAULT 0,
      total_wins INTEGER DEFAULT 0,
      total_referrals INTEGER DEFAULT 0,
      total_referral_earnings BIGINT DEFAULT 0,
      total_social_shares INTEGER DEFAULT 0,
      referral_code VARCHAR(20) UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 8),
      referred_by UUID REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token VARCHAR(255) NOT NULL UNIQUE,
      wallet_signature VARCHAR(255) NOT NULL,
      ip_address INET,
      user_agent TEXT,
      expires_at TIMESTAMP NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_goals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT NOT NULL,
      goal_type VARCHAR(50) NOT NULL,
      requirement_value INTEGER DEFAULT 1,
      reward_xp INTEGER DEFAULT 0,
      reward_bonus BIGINT DEFAULT 0,
      icon_url TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      is_daily BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_daily_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal_id UUID NOT NULL REFERENCES daily_goals(id) ON DELETE CASCADE,
      progress_date DATE NOT NULL DEFAULT CURRENT_DATE,
      current_progress INTEGER DEFAULT 0,
      is_completed BOOLEAN DEFAULT FALSE,
      completed_at TIMESTAMP,
      reward_claimed BOOLEAN DEFAULT FALSE,
      reward_claimed_at TIMESTAMP,
      UNIQUE(user_id, goal_id, progress_date)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_check_ins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      check_in_date DATE NOT NULL DEFAULT CURRENT_DATE,
      check_in_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      streak_count INTEGER DEFAULT 1,
      reward_xp INTEGER DEFAULT 0,
      reward_bonus BIGINT DEFAULT 0,
      ip_address INET,
      user_agent TEXT,
      UNIQUE(user_id, check_in_date)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS xp_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      transaction_type VARCHAR(50) NOT NULL,
      description TEXT,
      reference_id UUID,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create test functions
  await db.query(`
    CREATE OR REPLACE FUNCTION get_user_current_streak(target_user_id UUID)
    RETURNS INTEGER AS $$
    DECLARE
      current_streak INTEGER := 0;
      last_checkin_date DATE;
      check_date DATE;
      consecutive_days INTEGER := 0;
    BEGIN
      SELECT check_in_date INTO last_checkin_date
      FROM user_check_ins
      WHERE user_id = target_user_id
      ORDER BY check_in_date DESC
      LIMIT 1;
      
      IF last_checkin_date IS NULL THEN
        RETURN 0;
      END IF;
      
      IF last_checkin_date < CURRENT_DATE - INTERVAL '1 day' THEN
        RETURN 0;
      END IF;
      
      check_date := last_checkin_date;
      
      LOOP
        IF EXISTS(SELECT 1 FROM user_check_ins WHERE user_id = target_user_id AND check_in_date = check_date) THEN
          consecutive_days := consecutive_days + 1;
          check_date := check_date - INTERVAL '1 day';
        ELSE
          EXIT;
        END IF;
      END LOOP;
      
      RETURN consecutive_days;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await db.query(`
    CREATE OR REPLACE FUNCTION calculate_checkin_reward(streak_count INTEGER)
    RETURNS TABLE(xp_reward INTEGER, bonus_reward BIGINT) AS $$
    BEGIN
      xp_reward := 50;
      bonus_reward := 0;
      
      IF streak_count >= 7 THEN
        xp_reward := xp_reward + 100;
        bonus_reward := bonus_reward + 1000000;
      END IF;
      
      IF streak_count >= 30 THEN
        xp_reward := xp_reward + 500;
        bonus_reward := bonus_reward + 5000000;
      END IF;
      
      IF streak_count >= 100 THEN
        xp_reward := xp_reward + 1000;
        bonus_reward := bonus_reward + 10000000;
      END IF;
      
      IF streak_count > 7 THEN
        xp_reward := xp_reward + (((streak_count / 7) * 10) * xp_reward / 100);
      END IF;
      
      RETURN QUERY SELECT xp_reward, bonus_reward;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Insert test daily goals
  await db.query(`
    INSERT INTO daily_goals (name, description, goal_type, requirement_value, reward_xp, reward_bonus, sort_order) VALUES
    ('Social Media Share', 'Share a link on social platforms', 'social_share', 1, 100, 0, 1),
    ('Purchase Lottery Ticket', 'Purchase at least 1 lottery ticket', 'ticket_purchase', 1, 150, 0, 2),
    ('Twitter $MWOR Post', 'Make a Twitter/X post mentioning $MWOR', 'twitter_post', 1, 200, 1000000, 3),
    ('Invite New User', 'Successfully invite 1 new user', 'referral', 1, 300, 2000000, 4),
    ('Daily Check-in', 'Log in to the platform', 'check_in', 1, 50, 0, 0)
    ON CONFLICT (name) DO NOTHING
  `);

  logger.info('Test schema setup completed');
}

export async function cleanupTestDatabase(): Promise<void> {
  const db = getTestDb();
  
  // Clean up test data
  await db.query('TRUNCATE TABLE user_daily_progress CASCADE');
  await db.query('TRUNCATE TABLE user_check_ins CASCADE');
  await db.query('TRUNCATE TABLE xp_transactions CASCADE');
  await db.query('TRUNCATE TABLE user_sessions CASCADE');
  await db.query('TRUNCATE TABLE users CASCADE');
  
  logger.info('Test database cleaned up');
}

export async function closeTestDatabase(): Promise<void> {
  if (testDb) {
    await testDb.end();
    testDb = null;
    logger.info('Test database connection closed');
  }
}

// Test data factories
export function createTestUser(overrides: any = {}) {
  return {
    wallet_address: `test_wallet_${Math.random().toString(36).substring(7)}`,
    username: `test_user_${Math.random().toString(36).substring(7)}`,
    display_name: 'Test User',
    email: 'test@example.com',
    is_admin: false,
    ...overrides
  };
}

export function createTestGoal(overrides: any = {}) {
  return {
    name: `Test Goal ${Math.random().toString(36).substring(7)}`,
    description: 'Test goal description',
    goal_type: 'social_share',
    requirement_value: 1,
    reward_xp: 100,
    reward_bonus: 0,
    is_active: true,
    is_daily: true,
    sort_order: 0,
    ...overrides
  };
}