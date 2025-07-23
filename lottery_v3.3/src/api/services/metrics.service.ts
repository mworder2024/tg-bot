import { register, collectDefaultMetrics, Counter, Gauge, Histogram, Summary } from 'prom-client';
import { logger } from '../../utils/structured-logger.js';
import { redis, REDIS_KEYS } from './redis.service.js';
import { db } from './database.service.js';
import { io } from '../server.js';

// Metrics registry
const metricsRegistry = register;

// Configure default metrics collection
collectDefaultMetrics({ register: metricsRegistry });

// Custom metrics
const metrics = {
  // HTTP metrics
  httpRequestDuration: new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
  }),

  httpRequestTotal: new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
  }),

  // Game metrics
  activeGames: new Gauge({
    name: 'active_games_total',
    help: 'Number of active games'
  }),

  totalPlayers: new Gauge({
    name: 'total_players_online',
    help: 'Total number of players online'
  }),

  gameCreated: new Counter({
    name: 'games_created_total',
    help: 'Total number of games created',
    labelNames: ['type'] // free, paid
  }),

  gameCompleted: new Counter({
    name: 'games_completed_total',
    help: 'Total number of games completed',
    labelNames: ['type']
  }),

  // Payment metrics
  paymentProcessed: new Counter({
    name: 'payments_processed_total',
    help: 'Total number of payments processed',
    labelNames: ['status', 'type']
  }),

  paymentAmount: new Counter({
    name: 'payment_amount_total',
    help: 'Total payment amount in MWOR',
    labelNames: ['type']
  }),

  paymentDuration: new Histogram({
    name: 'payment_processing_duration_seconds',
    help: 'Duration of payment processing',
    buckets: [1, 5, 10, 30, 60, 120, 300]
  }),

  // Blockchain metrics
  blockchainTransactions: new Counter({
    name: 'blockchain_transactions_total',
    help: 'Total blockchain transactions',
    labelNames: ['type', 'status']
  }),

  walletBalance: new Gauge({
    name: 'wallet_balance',
    help: 'Wallet balance in tokens',
    labelNames: ['wallet', 'token']
  }),

  // Error metrics
  errors: new Counter({
    name: 'errors_total',
    help: 'Total number of errors',
    labelNames: ['type', 'severity']
  }),

  // WebSocket metrics
  websocketConnections: new Gauge({
    name: 'websocket_connections_active',
    help: 'Number of active WebSocket connections'
  }),

  // Database metrics
  databaseQueryDuration: new Histogram({
    name: 'database_query_duration_seconds',
    help: 'Duration of database queries',
    labelNames: ['query_type'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
  }),

  // Redis metrics
  redisOperationDuration: new Histogram({
    name: 'redis_operation_duration_seconds',
    help: 'Duration of Redis operations',
    labelNames: ['operation'],
    buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05]
  })
};

// Real-time metrics data structure
interface RealtimeMetrics {
  timestamp: Date;
  games: {
    active: number;
    pending: number;
    total24h: number;
  };
  players: {
    online: number;
    active: number;
    total24h: number;
  };
  payments: {
    processing: number;
    confirmed24h: number;
    failed24h: number;
    volume24h: number;
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    uptime: number;
    errorRate: number;
  };
}

export class MetricsService {
  private static instance: MetricsService;
  private collectionInterval: NodeJS.Timeout | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  /**
   * Start metrics collection
   */
  startCollection(): void {
    // Collect metrics every 10 seconds
    this.collectionInterval = setInterval(() => {
      this.collectMetrics();
    }, 10000);

    // Broadcast real-time metrics every 5 seconds
    this.broadcastInterval = setInterval(() => {
      this.broadcastRealtimeMetrics();
    }, 5000);

    logger.info('Metrics collection started');
  }

  /**
   * Stop metrics collection
   */
  stopCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    logger.info('Metrics collection stopped');
  }

  /**
   * Collect current metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      // Collect game metrics
      const activeGamesCount = await this.getActiveGamesCount();
      metrics.activeGames.set(activeGamesCount);

      // Collect player metrics
      const onlinePlayersCount = await this.getOnlinePlayersCount();
      metrics.totalPlayers.set(onlinePlayersCount);

      // Collect WebSocket metrics
      if (io) {
        const sockets = await io.fetchSockets();
        metrics.websocketConnections.set(sockets.length);
      }

      // Store metrics in Redis for historical data
      await this.storeMetricsSnapshot();

    } catch (error) {
      logger.error('Failed to collect metrics', { error: error.message });
      metrics.errors.inc({ type: 'metrics_collection', severity: 'high' });
    }
  }

  /**
   * Get active games count
   */
  private async getActiveGamesCount(): Promise<number> {
    try {
      const { rows } = await db.query(
        `SELECT COUNT(*) as count FROM game_metrics WHERE status IN ('pending', 'in_progress')`
      );
      return parseInt(rows[0].count) || 0;
    } catch (error) {
      logger.error('Failed to get active games count', { error: error.message });
      return 0;
    }
  }

  /**
   * Get online players count
   */
  private async getOnlinePlayersCount(): Promise<number> {
    try {
      const keys = await redis.keys(`${REDIS_KEYS.USER}online:*`);
      return keys.length;
    } catch (error) {
      logger.error('Failed to get online players count', { error: error.message });
      return 0;
    }
  }

  /**
   * Store metrics snapshot in Redis
   */
  private async storeMetricsSnapshot(): Promise<void> {
    const timestamp = new Date();
    const snapshot = {
      timestamp,
      activeGames: await this.getActiveGamesCount(),
      onlinePlayers: await this.getOnlinePlayersCount(),
      cpuUsage: process.cpuUsage(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };

    const key = `${REDIS_KEYS.METRIC}snapshot:${timestamp.getTime()}`;
    await redis.setJSON(key, snapshot, 3600); // Keep for 1 hour
  }

  /**
   * Broadcast real-time metrics via WebSocket
   */
  private async broadcastRealtimeMetrics(): Promise<void> {
    try {
      const metrics = await this.getRealtimeMetrics();
      
      if (io) {
        io.to('metrics').emit('metrics:update', metrics);
      }
    } catch (error) {
      logger.error('Failed to broadcast metrics', { error: error.message });
    }
  }

  /**
   * Get real-time metrics
   */
  async getRealtimeMetrics(): Promise<RealtimeMetrics> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get game metrics
    const gameMetrics = await db.query(
      `SELECT 
        COUNT(CASE WHEN status IN ('pending', 'in_progress') THEN 1 END) as active,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN created_at >= $1 THEN 1 END) as total_24h
       FROM game_metrics`,
      [yesterday]
    );

    // Get payment metrics
    const paymentMetrics = await db.query(
      `SELECT 
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'confirmed' AND created_at >= $1 THEN 1 END) as confirmed_24h,
        COUNT(CASE WHEN status = 'failed' AND created_at >= $1 THEN 1 END) as failed_24h,
        COALESCE(SUM(CASE WHEN status = 'confirmed' AND created_at >= $1 THEN amount END), 0) as volume_24h
       FROM transaction_logs
       WHERE transaction_type = 'payment'`,
      [yesterday]
    );

    // Get player metrics
    const playerMetrics = await db.query(
      `SELECT 
        COUNT(CASE WHEN last_active >= $1 THEN 1 END) as active_24h
       FROM player_analytics`,
      [yesterday]
    );

    // Get system metrics
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      timestamp: now,
      games: {
        active: parseInt(gameMetrics.rows[0].active) || 0,
        pending: parseInt(gameMetrics.rows[0].pending) || 0,
        total24h: parseInt(gameMetrics.rows[0].total_24h) || 0
      },
      players: {
        online: await this.getOnlinePlayersCount(),
        active: parseInt(playerMetrics.rows[0].active_24h) || 0,
        total24h: parseInt(playerMetrics.rows[0].active_24h) || 0
      },
      payments: {
        processing: parseInt(paymentMetrics.rows[0].processing) || 0,
        confirmed24h: parseInt(paymentMetrics.rows[0].confirmed_24h) || 0,
        failed24h: parseInt(paymentMetrics.rows[0].failed_24h) || 0,
        volume24h: parseFloat(paymentMetrics.rows[0].volume_24h) || 0
      },
      system: {
        cpuUsage: cpuUsage.user / 1000000, // Convert to seconds
        memoryUsage: memUsage.heapUsed / memUsage.heapTotal,
        uptime: process.uptime(),
        errorRate: 0 // Calculate from error metrics
      }
    };
  }

  /**
   * Get Prometheus metrics
   */
  async getPrometheusMetrics(): Promise<string> {
    return await metricsRegistry.metrics();
  }

  /**
   * Record HTTP request
   */
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    metrics.httpRequestDuration.observe(
      { method, route, status_code: statusCode.toString() },
      duration / 1000 // Convert to seconds
    );
    
    metrics.httpRequestTotal.inc({
      method,
      route,
      status_code: statusCode.toString()
    });
  }

  /**
   * Record game event
   */
  recordGameEvent(event: 'created' | 'completed', type: 'free' | 'paid'): void {
    if (event === 'created') {
      metrics.gameCreated.inc({ type });
    } else {
      metrics.gameCompleted.inc({ type });
    }
  }

  /**
   * Record payment event
   */
  recordPaymentEvent(status: string, type: string, amount?: number): void {
    metrics.paymentProcessed.inc({ status, type });
    
    if (amount && status === 'confirmed') {
      metrics.paymentAmount.inc({ type }, amount);
    }
  }

  /**
   * Record blockchain transaction
   */
  recordBlockchainTransaction(type: string, status: string): void {
    metrics.blockchainTransactions.inc({ type, status });
  }

  /**
   * Record error
   */
  recordError(type: string, severity: string): void {
    metrics.errors.inc({ type, severity });
  }

  /**
   * Update wallet balance
   */
  updateWalletBalance(wallet: string, token: string, balance: number): void {
    metrics.walletBalance.set({ wallet, token }, balance);
  }

  /**
   * Get historical metrics
   */
  async getHistoricalMetrics(
    period: 'hour' | 'day' | 'week' | 'month',
    metric: string
  ): Promise<any[]> {
    // Implementation would query stored metrics from Redis/database
    // and aggregate based on the requested period
    return [];
  }

  /**
   * Get custom metrics for dashboards
   */
  async getCustomMetrics(): Promise<any> {
    const realtime = await this.getRealtimeMetrics();
    
    return {
      overview: {
        totalRevenue24h: realtime.payments.volume24h,
        activeGames: realtime.games.active,
        onlinePlayers: realtime.players.online,
        successRate: realtime.payments.confirmed24h / 
          (realtime.payments.confirmed24h + realtime.payments.failed24h) || 0
      },
      trends: {
        // Add trend data here
      }
    };
  }
}

// Export metrics for use in other modules
export { metrics };