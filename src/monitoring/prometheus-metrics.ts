import { register, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { logger } from '../utils/logger';

// Enable default system metrics
collectDefaultMetrics({ register });

// Game Metrics
export const gameMetrics = {
  // Counters
  gamesCreated: new Counter({
    name: 'lottery_games_created_total',
    help: 'Total number of lottery games created',
    labelNames: ['chat_id', 'game_type', 'admin_user']
  }),

  gamesFinished: new Counter({
    name: 'lottery_games_finished_total',
    help: 'Total number of lottery games finished',
    labelNames: ['chat_id', 'game_type', 'winner_count']
  }),

  playersJoined: new Counter({
    name: 'lottery_players_joined_total',
    help: 'Total number of players who joined games',
    labelNames: ['chat_id', 'game_id']
  }),

  playersEliminated: new Counter({
    name: 'lottery_players_eliminated_total',
    help: 'Total number of players eliminated',
    labelNames: ['chat_id', 'game_id']
  }),

  tokensDistributed: new Counter({
    name: 'lottery_tokens_distributed_total',
    help: 'Total tokens distributed as prizes',
    labelNames: ['chat_id', 'game_type']
  }),

  commandsExecuted: new Counter({
    name: 'lottery_commands_executed_total',
    help: 'Total number of bot commands executed',
    labelNames: ['command', 'chat_id', 'success']
  }),

  // Gauges
  activeGames: new Gauge({
    name: 'lottery_active_games',
    help: 'Number of currently active games',
    labelNames: ['state']
  }),

  activePlayers: new Gauge({
    name: 'lottery_active_players',
    help: 'Number of players in active games',
    labelNames: ['chat_id']
  }),

  scheduledEvents: new Gauge({
    name: 'lottery_scheduled_events',
    help: 'Number of scheduled events',
    labelNames: ['chat_id']
  }),

  // Histograms
  gameDuration: new Histogram({
    name: 'lottery_game_duration_seconds',
    help: 'Duration of completed games in seconds',
    labelNames: ['chat_id', 'game_type'],
    buckets: [30, 60, 120, 300, 600, 1200, 1800, 3600] // 30s to 1h
  }),

  drawingTime: new Histogram({
    name: 'lottery_drawing_duration_seconds',
    help: 'Time taken for each drawing round',
    labelNames: ['chat_id', 'round'],
    buckets: [1, 2, 5, 10, 15, 30, 60] // 1s to 1min
  }),

  prizeAmount: new Histogram({
    name: 'lottery_prize_amount',
    help: 'Prize amounts distributed',
    labelNames: ['chat_id', 'game_type'],
    buckets: [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]
  })
};

// Bot Performance Metrics
export const botMetrics = {
  // Message processing
  messagesProcessed: new Counter({
    name: 'bot_messages_processed_total',
    help: 'Total messages processed by the bot',
    labelNames: ['type', 'chat_id']
  }),

  messageProcessingTime: new Histogram({
    name: 'bot_message_processing_seconds',
    help: 'Time taken to process messages',
    labelNames: ['type'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] // 10ms to 10s
  }),

  // API calls
  telegramApiCalls: new Counter({
    name: 'bot_telegram_api_calls_total',
    help: 'Total Telegram API calls made',
    labelNames: ['method', 'status']
  }),

  // Memory and performance
  memoryUsage: new Gauge({
    name: 'bot_memory_usage_bytes',
    help: 'Bot memory usage in bytes',
    labelNames: ['type'] // heap_used, heap_total, rss, external
  }),

  uptime: new Gauge({
    name: 'bot_uptime_seconds',
    help: 'Bot uptime in seconds'
  }),

  // Error tracking
  errors: new Counter({
    name: 'bot_errors_total',
    help: 'Total number of errors',
    labelNames: ['type', 'command', 'chat_id']
  })
};

// System Metrics
export const systemMetrics = {
  // Database operations
  databaseOperations: new Counter({
    name: 'lottery_database_operations_total',
    help: 'Total database operations',
    labelNames: ['operation', 'table', 'status']
  }),

  databaseResponseTime: new Histogram({
    name: 'lottery_database_response_seconds',
    help: 'Database response time',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5] // 1ms to 2.5s
  }),

  // Cache operations
  cacheOperations: new Counter({
    name: 'lottery_cache_operations_total',
    help: 'Total cache operations',
    labelNames: ['operation', 'status'] // get, set, delete
  }),

  cacheHitRate: new Gauge({
    name: 'lottery_cache_hit_rate',
    help: 'Cache hit rate percentage'
  }),

  // Queue metrics
  messageQueueSize: new Gauge({
    name: 'lottery_message_queue_size',
    help: 'Number of messages in processing queue',
    labelNames: ['priority']
  }),

  queueProcessingTime: new Histogram({
    name: 'lottery_queue_processing_seconds',
    help: 'Time messages spend in queue',
    labelNames: ['priority'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60] // 100ms to 1min
  })
};

// Business Metrics
export const businessMetrics = {
  // User engagement
  dailyActiveUsers: new Gauge({
    name: 'lottery_daily_active_users',
    help: 'Number of daily active users',
    labelNames: ['chat_id']
  }),

  userRetention: new Gauge({
    name: 'lottery_user_retention_rate',
    help: 'User retention rate percentage',
    labelNames: ['period'] // 7d, 30d
  }),

  // Revenue tracking (if applicable)
  revenueGenerated: new Counter({
    name: 'lottery_revenue_generated',
    help: 'Revenue generated (if applicable)',
    labelNames: ['source', 'chat_id']
  }),

  // Group statistics
  activeGroups: new Gauge({
    name: 'lottery_active_groups',
    help: 'Number of active groups using the bot'
  }),

  averagePlayersPerGame: new Gauge({
    name: 'lottery_average_players_per_game',
    help: 'Average number of players per game',
    labelNames: ['chat_id']
  })
};

// Utility functions for metric collection
export class MetricsCollector {
  private startTime = Date.now();

  constructor() {
    // Update uptime every 10 seconds
    setInterval(() => {
      botMetrics.uptime.set((Date.now() - this.startTime) / 1000);
    }, 10000);

    // Update memory usage every 30 seconds
    setInterval(() => {
      const memUsage = process.memoryUsage();
      botMetrics.memoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
      botMetrics.memoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
      botMetrics.memoryUsage.set({ type: 'rss' }, memUsage.rss);
      botMetrics.memoryUsage.set({ type: 'external' }, memUsage.external);
    }, 30000);
  }

  // Game metrics helpers
  recordGameCreated(chatId: string, gameType: string, adminUser: string) {
    gameMetrics.gamesCreated.inc({ chat_id: chatId, game_type: gameType, admin_user: adminUser });
    logger.info(`Metrics: Game created in ${chatId} by ${adminUser}`);
  }

  recordGameFinished(chatId: string, gameType: string, winnerCount: number, duration: number, prizeAmount: number) {
    gameMetrics.gamesFinished.inc({ chat_id: chatId, game_type: gameType, winner_count: winnerCount.toString() });
    gameMetrics.gameDuration.observe({ chat_id: chatId, game_type: gameType }, duration);
    gameMetrics.prizeAmount.observe({ chat_id: chatId, game_type: gameType }, prizeAmount);
    gameMetrics.tokensDistributed.inc({ chat_id: chatId, game_type: gameType }, prizeAmount);
    logger.info(`Metrics: Game finished in ${chatId}, duration: ${duration}s, prize: ${prizeAmount}`);
  }

  recordPlayerJoined(chatId: string, gameId: string) {
    gameMetrics.playersJoined.inc({ chat_id: chatId, game_id: gameId });
  }

  recordPlayerEliminated(chatId: string, gameId: string) {
    gameMetrics.playersEliminated.inc({ chat_id: chatId, game_id: gameId });
  }

  recordCommand(command: string, chatId: string, success: boolean) {
    gameMetrics.commandsExecuted.inc({ 
      command, 
      chat_id: chatId, 
      success: success.toString() 
    });
  }

  recordDrawingTime(chatId: string, round: number, duration: number) {
    gameMetrics.drawingTime.observe({ chat_id: chatId, round: round.toString() }, duration);
  }

  // Bot performance helpers
  recordMessageProcessed(type: string, chatId: string, processingTime: number) {
    botMetrics.messagesProcessed.inc({ type, chat_id: chatId });
    botMetrics.messageProcessingTime.observe({ type }, processingTime);
  }

  recordTelegramApiCall(method: string, status: string) {
    botMetrics.telegramApiCalls.inc({ method, status });
  }

  recordError(type: string, command: string, chatId: string) {
    botMetrics.errors.inc({ type, command, chat_id: chatId });
    logger.error(`Metrics: Error recorded - type: ${type}, command: ${command}, chat: ${chatId}`);
  }

  // System metrics helpers
  recordDatabaseOperation(operation: string, table: string, status: string, responseTime: number) {
    systemMetrics.databaseOperations.inc({ operation, table, status });
    systemMetrics.databaseResponseTime.observe({ operation, table }, responseTime);
  }

  recordCacheOperation(operation: string, status: string) {
    systemMetrics.cacheOperations.inc({ operation, status });
  }

  updateCacheHitRate(hitRate: number) {
    systemMetrics.cacheHitRate.set(hitRate);
  }

  updateMessageQueueSize(priority: string, size: number) {
    systemMetrics.messageQueueSize.set({ priority }, size);
  }

  recordQueueProcessingTime(priority: string, processingTime: number) {
    systemMetrics.queueProcessingTime.observe({ priority }, processingTime);
  }

  // Business metrics helpers
  updateActiveGames(state: string, count: number) {
    gameMetrics.activeGames.set({ state }, count);
  }

  updateActivePlayers(chatId: string, count: number) {
    gameMetrics.activePlayers.set({ chat_id: chatId }, count);
  }

  updateScheduledEvents(chatId: string, count: number) {
    gameMetrics.scheduledEvents.set({ chat_id: chatId }, count);
  }

  updateDailyActiveUsers(chatId: string, count: number) {
    businessMetrics.dailyActiveUsers.set({ chat_id: chatId }, count);
  }

  updateActiveGroups(count: number) {
    businessMetrics.activeGroups.set(count);
  }

  updateAveragePlayersPerGame(chatId: string, average: number) {
    businessMetrics.averagePlayersPerGame.set({ chat_id: chatId }, average);
  }

  // Get all metrics for HTTP endpoint
  getMetrics(): Promise<string> {
    return register.metrics();
  }

  // Clear all metrics (useful for testing)
  clearMetrics() {
    register.clear();
  }
}

export const metricsCollector = new MetricsCollector();