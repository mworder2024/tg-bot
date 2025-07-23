import { jest } from '@jest/globals';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Mock external services by default
jest.mock('@anthropic-ai/sdk');
jest.mock('node-telegram-bot-api');
jest.mock('telegraf');

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