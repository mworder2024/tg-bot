import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import { setupTestGlobals } from './setup/mock-test-env';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Setup test globals and mock database
setupTestGlobals();

// Mock external services by default
jest.mock('@anthropic-ai/sdk');
jest.mock('node-telegram-bot-api');
jest.mock('telegraf');

// Mock PostgreSQL to prevent connection attempts
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    }),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined),
  })),
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Global test configuration
global.beforeEach(() => {
  jest.clearAllMocks();
});

// Setup test timeout
jest.setTimeout(30000);

// Mock console methods in test environment
if (process.env.NODE_ENV === 'test') {
  global.console = {
    ...console,
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Cleanup function for tests
global.afterEach(async () => {
  // Reset all mocks
  jest.resetAllMocks();
  
  // Clear any timers
  jest.clearAllTimers();
});