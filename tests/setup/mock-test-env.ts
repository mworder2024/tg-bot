import * as dotenv from 'dotenv';
import { logger } from '../../src/utils/logger';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Mock database setup for testing without PostgreSQL
export const mockDbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'raffle_hub_test_mock',
  ssl: false,
};

// Test JWT secret
export const testJwtSecret = process.env.TEST_JWT_SECRET || 'test-jwt-secret-key-very-secure';

// Test Solana config
export const testSolanaConfig = {
  rpcUrl: process.env.TEST_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  programId: process.env.TEST_SOLANA_PROGRAM_ID || '11111111111111111111111111111112',
};

// Mock database pool for tests
export class MockTestDb {
  async connect() {
    return {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };
  }

  async query() {
    return { rows: [], rowCount: 0 };
  }

  async end() {
    return;
  }
}

export function getMockTestDb(): MockTestDb {
  return new MockTestDb();
}

export async function setupMockDatabase(): Promise<MockTestDb> {
  const db = getMockTestDb();
  
  try {
    logger.info('Mock test database setup successfully (no PostgreSQL required)');
    return db;
  } catch (error) {
    logger.error('Mock test database setup failed:', error);
    throw error;
  }
}

// Environment validation for tests
export function validateTestEnvironment(): boolean {
  const required = ['NODE_ENV'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.warn(`Missing test environment variables: ${missing.join(', ')}`);
  }
  
  return missing.length === 0;
}

export function setupTestGlobals(): void {
  // Set test environment
  process.env.NODE_ENV = 'test';
  
  // Disable logging in tests unless explicitly enabled
  if (!process.env.ENABLE_TEST_LOGGING) {
    logger.transports.forEach(transport => {
      transport.silent = true;
    });
  }
  
  // Setup test timeouts
  jest.setTimeout(10000); // 10 second timeout for tests
}