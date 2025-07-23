import { z } from 'zod';

const envSchema = z.object({
  // Solana Configuration
  NEXT_PUBLIC_SOLANA_RPC_URL: z.string().url(),
  NEXT_PUBLIC_SOLANA_NETWORK: z.enum(['devnet', 'testnet', 'mainnet-beta']),
  NEXT_PUBLIC_PROGRAM_ID: z.string().min(32),
  
  // FaunaDB Configuration (server-side only)
  FAUNA_SECRET_KEY: z.string().optional(),
  FAUNA_DOMAIN: z.string().default('db.fauna.com'),
  
  // GraphQL Configuration
  NEXT_PUBLIC_GRAPHQL_ENDPOINT: z.string().url(),
  NEXT_PUBLIC_WS_ENDPOINT: z.string().url(),
  
  // Platform Integration
  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: z.string().optional(),
  NEXT_PUBLIC_DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  
  // Redis Configuration (server-side only)
  REDIS_URL: z.string().url().optional(),
  
  // Authentication
  NEXT_PUBLIC_SIWS_DOMAIN: z.string(),
  JWT_SECRET: z.string().optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().optional(),
  
  // Analytics (Optional)
  NEXT_PUBLIC_GA_ID: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  
  // Environment
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

// Separate schemas for client and server
const clientEnvSchema = envSchema.pick({
  NEXT_PUBLIC_SOLANA_RPC_URL: true,
  NEXT_PUBLIC_SOLANA_NETWORK: true,
  NEXT_PUBLIC_PROGRAM_ID: true,
  NEXT_PUBLIC_GRAPHQL_ENDPOINT: true,
  NEXT_PUBLIC_WS_ENDPOINT: true,
  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: true,
  NEXT_PUBLIC_DISCORD_CLIENT_ID: true,
  NEXT_PUBLIC_SIWS_DOMAIN: true,
  NEXT_PUBLIC_GA_ID: true,
  NEXT_PUBLIC_SENTRY_DSN: true,
  NODE_ENV: true,
});

const serverEnvSchema = envSchema;

// Type exports
export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

// Validation functions
export function validateClientEnv(): ClientEnv {
  try {
    return clientEnvSchema.parse({
      NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
      NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK,
      NEXT_PUBLIC_PROGRAM_ID: process.env.NEXT_PUBLIC_PROGRAM_ID,
      NEXT_PUBLIC_GRAPHQL_ENDPOINT: process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT,
      NEXT_PUBLIC_WS_ENDPOINT: process.env.NEXT_PUBLIC_WS_ENDPOINT,
      NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
      NEXT_PUBLIC_DISCORD_CLIENT_ID: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
      NEXT_PUBLIC_SIWS_DOMAIN: process.env.NEXT_PUBLIC_SIWS_DOMAIN,
      NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID,
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      NODE_ENV: process.env.NODE_ENV,
    });
  } catch (error) {
    console.error('❌ Invalid environment variables:', error);
    throw new Error('Invalid environment variables');
  }
}

export function validateServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('Server environment variables should not be validated on the client');
  }
  
  try {
    return serverEnvSchema.parse(process.env);
  } catch (error) {
    console.error('❌ Invalid server environment variables:', error);
    throw new Error('Invalid server environment variables');
  }
}

// Export validated env (only use on server)
export const env = typeof window === 'undefined' ? validateServerEnv() : validateClientEnv();

// Export client env for use in browser
export const clientEnv = validateClientEnv();