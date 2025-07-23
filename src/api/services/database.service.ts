import { Pool, PoolConfig } from 'pg';
import { logger } from '../../utils/structured-logger.js';
import * as fs from 'fs';
import * as path from 'path';

// Database pool instance
let pool: Pool | null = null;

// Database configuration
const dbConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'lottery_bot_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: parseInt(process.env.DB_POOL_SIZE || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

/**
 * Initialize database connection pool
 */
export async function initializeDatabase(): Promise<void> {
  try {
    pool = new Pool(dbConfig);

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();

    logger.info('Database connection established', {
      host: dbConfig.host,
      database: dbConfig.database
    });

    // Run migrations if in development
    if (process.env.NODE_ENV === 'development') {
      await runMigrations();
    }

  } catch (error) {
    logger.fatal('Failed to initialize database', { error: error.message });
    throw error;
  }
}

/**
 * Get database pool instance
 */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return pool;
}

/**
 * Execute a query with automatic connection handling
 */
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  const pool = getPool();
  const start = Date.now();
  
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    logger.debug('Database query executed', {
      query: text.substring(0, 100),
      duration,
      rowCount: result.rowCount
    });
    
    return result;
  } catch (error) {
    logger.error('Database query failed', {
      query: text.substring(0, 100),
      error: error.message
    });
    throw error;
  }
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  callback: (client: any) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction failed', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run database migrations
 */
async function runMigrations(): Promise<void> {
  try {
    const schemaPath = path.join(process.cwd(), 'src', 'database', 'schema.sql');
    
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const pool = getPool();
      
      // Split by semicolons but be careful with functions
      const statements = schema
        .split(/;\s*$/m)
        .filter(stmt => stmt.trim().length > 0)
        .map(stmt => stmt.trim() + ';');
      
      for (const statement of statements) {
        if (statement.trim()) {
          await pool.query(statement);
        }
      }
      
      logger.info('Database migrations completed');
    }
  } catch (error) {
    logger.error('Failed to run migrations', { error: error.message });
    // Don't throw in development, just log the error
  }
}

/**
 * Database helper functions
 */
export const db = {
  // Game metrics
  async createGameMetric(data: {
    gameId: string;
    startTime: Date;
    playerCount: number;
    maxNumber: number;
    isPaid: boolean;
    entryFee?: number;
  }) {
    const { rows } = await query(
      `INSERT INTO game_metrics 
       (game_id, start_time, player_count, max_number, is_paid, entry_fee, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'in_progress')
       RETURNING *`,
      [data.gameId, data.startTime, data.playerCount, data.maxNumber, data.isPaid, data.entryFee]
    );
    return rows[0];
  },

  async updateGameMetric(gameId: string, updates: any) {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    
    const { rows } = await query(
      `UPDATE game_metrics SET ${setClause} WHERE game_id = $1 RETURNING *`,
      [gameId, ...values]
    );
    return rows[0];
  },

  // Player analytics
  async upsertPlayerAnalytics(data: {
    userId: string;
    username?: string;
    incrementGamesPlayed?: boolean;
    incrementGamesWon?: boolean;
    addSpent?: number;
    addWon?: number;
    walletAddress?: string;
  }) {
    const { rows } = await query(
      `INSERT INTO player_analytics 
       (user_id, username, games_played, games_won, total_spent, total_won, last_active, wallet_address)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (user_id) DO UPDATE SET
         username = COALESCE($2, player_analytics.username),
         games_played = player_analytics.games_played + $3,
         games_won = player_analytics.games_won + $4,
         total_spent = player_analytics.total_spent + $5,
         total_won = player_analytics.total_won + $6,
         last_active = NOW(),
         wallet_address = COALESCE($7, player_analytics.wallet_address)
       RETURNING *`,
      [
        data.userId,
        data.username,
        data.incrementGamesPlayed ? 1 : 0,
        data.incrementGamesWon ? 1 : 0,
        data.addSpent || 0,
        data.addWon || 0,
        data.walletAddress
      ]
    );
    return rows[0];
  },

  // Transaction logging
  async createTransactionLog(data: {
    transactionType: string;
    userId?: string;
    gameId?: string;
    paymentId?: string;
    amount: number;
    token?: string;
    status: string;
    blockchainHash?: string;
    fromAddress?: string;
    toAddress?: string;
    metadata?: any;
  }) {
    const { rows } = await query(
      `INSERT INTO transaction_logs 
       (transaction_type, user_id, game_id, payment_id, amount, token, status, 
        blockchain_hash, from_address, to_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.transactionType,
        data.userId,
        data.gameId,
        data.paymentId,
        data.amount,
        data.token || 'MWOR',
        data.status,
        data.blockchainHash,
        data.fromAddress,
        data.toAddress,
        data.metadata
      ]
    );
    return rows[0];
  },

  // System events
  async createSystemEvent(data: {
    eventType: string;
    severity: string;
    component?: string;
    message: string;
    details?: any;
    errorStack?: string;
  }) {
    const { rows } = await query(
      `INSERT INTO system_events 
       (event_type, severity, component, message, details, error_stack)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.eventType,
        data.severity,
        data.component,
        data.message,
        data.details,
        data.errorStack
      ]
    );
    return rows[0];
  },

  // Configuration
  async getConfig(key: string) {
    const { rows } = await query(
      'SELECT * FROM bot_configuration WHERE key = $1',
      [key]
    );
    return rows[0];
  },

  async setConfig(key: string, value: any, updatedBy: string, description?: string) {
    const { rows } = await query(
      `INSERT INTO bot_configuration (key, value, description, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET
         value = $2,
         description = COALESCE($3, bot_configuration.description),
         updated_by = $4,
         updated_at = NOW()
       RETURNING *`,
      [key, JSON.stringify(value), description, updatedBy]
    );
    return rows[0];
  },

  // Audit logging
  async createAuditLog(data: {
    action: string;
    actorId: string;
    actorUsername?: string;
    actorIp?: string;
    targetType?: string;
    targetId?: string;
    oldValue?: any;
    newValue?: any;
    metadata?: any;
  }) {
    const { rows } = await query(
      `INSERT INTO audit_logs 
       (action, actor_id, actor_username, actor_ip, target_type, target_id, 
        old_value, new_value, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.action,
        data.actorId,
        data.actorUsername,
        data.actorIp,
        data.targetType,
        data.targetId,
        data.oldValue,
        data.newValue,
        data.metadata
      ]
    );
    return rows[0];
  },

  // Add the query method
  query,
  
  // Add the end method for cleanup
  async end() {
    if (pool) {
      await pool.end();
    }
  }
};

/**
 * Close database connections
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    logger.info('Database connections closed');
  }
}