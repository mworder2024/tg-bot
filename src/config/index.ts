import dotenv from 'dotenv';
import { cleanEnv, str, num, bool, url } from 'envalid';

dotenv.config();

const env = cleanEnv(process.env, {
  // Bot Configuration
  BOT_TOKEN: str({ desc: 'Telegram bot token (production)' }),
  BOT_TOKEN_DEV: str({ 
    desc: 'Telegram bot token for development', 
    default: '',
    devDefault: '' 
  }),
  ENVIRONMENT: str({ 
    default: 'development',
    choices: ['development', 'staging', 'production'] 
  }),
  
  // Database (optional - web/API removed)
  DATABASE_URL: str({ 
    desc: 'PostgreSQL connection string', 
    default: '', 
    devDefault: '' 
  }),
  
  // Redis
  REDIS_URL: str({ 
    default: 'redis://localhost:6379',
    desc: 'Redis connection string' 
  }),
  REDIS_URL_DEV: str({ 
    desc: 'Redis connection string for development', 
    default: 'redis://localhost:6379',
    devDefault: 'redis://localhost:6379' 
  }),
  
  // API Server (optional - web/API removed)
  PORT: num({ default: 3000 }),
  API_URL: url({ default: 'http://localhost:3000' }),
  JWT_SECRET: str({ 
    desc: 'JWT secret for API authentication', 
    default: 'jwt-secret-not-used',
    devDefault: 'jwt-secret-not-used' 
  }),
  
  // Solana Configuration
  SOLANA_NETWORK: str({ 
    default: 'devnet',
    choices: ['localnet', 'devnet', 'mainnet-beta'] 
  }),
  SOLANA_RPC_URL: url({ 
    default: 'https://api.devnet.solana.com',
    desc: 'Solana RPC endpoint' 
  }),
  SOLANA_WS_URL: url({ 
    default: 'wss://api.devnet.solana.com',
    desc: 'Solana WebSocket endpoint' 
  }),
  SOLANA_PROGRAM_ID: str({ desc: 'Deployed lottery program ID', default: '' }),
  SOLANA_TREASURY_PDA: str({ desc: 'Treasury PDA address', default: '' }),
  MWOR_TOKEN_MINT: str({ desc: 'MWOR token mint address', default: '' }),
  VRF_ORACLE_PUBKEY: str({ desc: 'VRF oracle public key', default: '' }),
  BOT_WALLET_KEY: str({ desc: 'Bot wallet private key (base58)', default: '' }),
  
  // Security
  WEBHOOK_SECRET: str({ 
    default: 'webhook-secret',
    desc: 'Webhook verification secret' 
  }),
  RATE_LIMIT_WINDOW: num({ default: 60000 }), // 1 minute
  RATE_LIMIT_MAX: num({ default: 100 }),
  
  // Monitoring
  SENTRY_DSN: str({ default: '' }),
  LOG_LEVEL: str({ 
    default: 'info',
    choices: ['error', 'warn', 'info', 'debug'] 
  }),
  
  // VRF
  VRF_SECRET: str({ 
    default: 'vrf-secret-key',
    desc: 'VRF secret for random number generation' 
  }),
  
  // Anthropic API
  ANTHROPIC_API_KEY: str({ desc: 'Anthropic API key for Claude integration', default: '' }),
  ANTHROPIC_MAX_TOKENS: num({ default: 4000 }),
  ANTHROPIC_MODEL: str({ default: 'claude-3-5-sonnet-20241022' }),
  ANTHROPIC_RATE_LIMIT_PER_MINUTE: num({ default: 50 }),
  ANTHROPIC_RATE_LIMIT_PER_HOUR: num({ default: 500 }),
  
  // Quiz Bot Configuration
  QUIZ_SESSION_TIMEOUT: num({ default: 300000 }), // 5 minutes
  QUIZ_QUESTION_TIMEOUT: num({ default: 30000 }), // 30 seconds
  QUIZ_MAX_QUESTIONS_PER_SESSION: num({ default: 10 }),
  QUIZ_VOTING_TIMEOUT: num({ default: 120000 }), // 2 minutes
  
  // Dual Bot Instance
  PRIMARY_BOT_TOKEN: str({ default: '' }),
  SECONDARY_BOT_TOKEN: str({ default: '' }),
  BOT_INSTANCE_MODE: str({ 
    default: 'primary',
    choices: ['primary', 'secondary'] 
  }),

  // Dashboard Authentication
  DASHBOARD_ADMIN_TOKEN: str({ 
    default: 'admin-token-change-this',
    desc: 'Admin token for dashboard authentication' 
  }),
  
  // Feature Flags
  ENABLE_PAID_GAMES: bool({ default: true }),
  ENABLE_WEB_DASHBOARD: bool({ default: true }),
  ENABLE_BLOCKCHAIN: bool({ default: true }),
  ENABLE_QUIZ_MODE: bool({ default: true }),
  ENABLE_ANTHROPIC_INTEGRATION: bool({ default: true }),
});

// Auto-select appropriate bot token based on environment
function getBotToken(): string {
  const environment = env.ENVIRONMENT;
  
  if (environment === 'development') {
    // Use development token if available, otherwise fall back to main token
    if (env.BOT_TOKEN_DEV && env.BOT_TOKEN_DEV.trim() !== '') {
      console.log('🔧 Using development bot token for local testing');
      return env.BOT_TOKEN_DEV;
    } else {
      console.warn('⚠️  BOT_TOKEN_DEV not set! Using production token for development (may cause conflicts)');
      return env.BOT_TOKEN;
    }
  }
  
  // Production/staging uses main token
  console.log(`🚀 Using production bot token for ${environment} environment`);
  return env.BOT_TOKEN;
}

// Auto-select appropriate Redis URL based on environment
function getRedisUrl(): string {
  const environment = env.ENVIRONMENT;
  
  if (environment === 'development') {
    console.log('🔧 Using local Redis for development');
    return env.REDIS_URL_DEV;
  }
  
  // Production/staging uses main Redis
  console.log(`🚀 Using production Redis for ${environment} environment`);
  return env.REDIS_URL;
}

export default {
  bot: {
    token: getBotToken(),
    environment: env.ENVIRONMENT,
    webhookSecret: env.WEBHOOK_SECRET,
  },
  
  database: {
    url: env.DATABASE_URL,
  },
  
  redis: {
    url: getRedisUrl(),
  },
  
  api: {
    port: env.PORT,
    url: env.API_URL,
    jwtSecret: env.JWT_SECRET,
  },
  
  solana: {
    network: env.SOLANA_NETWORK,
    rpcUrl: env.SOLANA_RPC_URL,
    wsUrl: env.SOLANA_WS_URL,
    programId: env.SOLANA_PROGRAM_ID,
    treasuryPDA: env.SOLANA_TREASURY_PDA,
    tokenMint: env.MWOR_TOKEN_MINT,
    vrfOracle: env.VRF_ORACLE_PUBKEY,
    botWalletKey: env.BOT_WALLET_KEY,
  },
  
  security: {
    rateLimitWindow: env.RATE_LIMIT_WINDOW,
    rateLimitMax: env.RATE_LIMIT_MAX,
  },
  
  monitoring: {
    sentryDsn: env.SENTRY_DSN,
    logLevel: env.LOG_LEVEL,
  },
  
  vrf: {
    secret: env.VRF_SECRET,
  },
  
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    maxTokens: env.ANTHROPIC_MAX_TOKENS,
    model: env.ANTHROPIC_MODEL,
    rateLimitPerMinute: env.ANTHROPIC_RATE_LIMIT_PER_MINUTE,
    rateLimitPerHour: env.ANTHROPIC_RATE_LIMIT_PER_HOUR,
  },
  
  quiz: {
    sessionTimeout: env.QUIZ_SESSION_TIMEOUT,
    questionTimeout: env.QUIZ_QUESTION_TIMEOUT,
    maxQuestionsPerSession: env.QUIZ_MAX_QUESTIONS_PER_SESSION,
    votingTimeout: env.QUIZ_VOTING_TIMEOUT,
  },
  
  botInstance: {
    primaryToken: env.PRIMARY_BOT_TOKEN || env.BOT_TOKEN,
    secondaryToken: env.SECONDARY_BOT_TOKEN || env.BOT_TOKEN,
    mode: env.BOT_INSTANCE_MODE,
  },
  
  dashboard: {
    adminToken: env.DASHBOARD_ADMIN_TOKEN,
  },

  features: {
    paidGames: env.ENABLE_PAID_GAMES,
    webDashboard: false, // Web dashboard removed
    blockchain: env.ENABLE_BLOCKCHAIN,
    quizMode: env.ENABLE_QUIZ_MODE,
    anthropicIntegration: env.ENABLE_ANTHROPIC_INTEGRATION,
  },
  
  isProduction: env.ENVIRONMENT === 'production',
  isDevelopment: env.ENVIRONMENT === 'development',
};

// Export utility functions
export { getBotToken, getRedisUrl };