import { EventEmitter } from 'events';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { questionGeneratorService } from './question-generator.service.js';
import { logger } from '../utils/logger.js';

export interface GeneratorAlert {
  id: string;
  type: 'pool_low' | 'queue_backup' | 'rate_limit' | 'quality_decline' | 'service_error';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  data: any;
  timestamp: Date;
  acknowledged: boolean;
  resolvedAt?: Date;
}

export interface PerformanceMetrics {
  timestamp: Date;
  requestsPerMinute: number;
  averageResponseTime: number;
  successRate: number;
  queueLength: number;
  poolUtilization: number;
  rateLimitHits: number;
  errorRate: number;
  topicDistribution: Record<string, number>;
}

export interface RealtimeStats {
  activeRequests: number;
  queueLength: number;
  poolsBelow50Percent: number;
  poolsBelow20Percent: number;
  rateLimitedUsers: number;
  errorCount: number;
  lastUpdated: Date;
}

export class QuestionGeneratorMonitorService extends EventEmitter {
  private readonly METRICS_PREFIX = 'qg_metrics:';
  private readonly ALERTS_PREFIX = 'qg_alerts:';
  private readonly REALTIME_KEY = 'qg_realtime_stats';
  
  private alerts: Map<string, GeneratorAlert> = new Map();
  private performanceHistory: PerformanceMetrics[] = [];
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis
  ) {
    super();
    this.initialize();
  }

  /**
   * Initialize the monitoring service
   */
  private async initialize(): Promise<void> {
    try {
      await this.createMonitoringTables();
      await this.loadExistingAlerts();
      await this.startMonitoring();
      
      logger.info('Question Generator Monitor Service initialized');
    } catch (error) {
      logger.error('Failed to initialize monitor service:', error);
      throw error;
    }
  }

  /**
   * Create monitoring database tables
   */
  private async createMonitoringTables(): Promise<void> {
    const tables = [
      `
      CREATE TABLE IF NOT EXISTS generator_alerts (
        id VARCHAR(36) PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        data JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        acknowledged BOOLEAN DEFAULT FALSE,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS generator_metrics (
        id VARCHAR(36) PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        requests_per_minute INTEGER DEFAULT 0,
        average_response_time INTEGER DEFAULT 0,
        success_rate DECIMAL(5,4) DEFAULT 0,
        queue_length INTEGER DEFAULT 0,
        pool_utilization DECIMAL(5,4) DEFAULT 0,
        rate_limit_hits INTEGER DEFAULT 0,
        error_rate DECIMAL(5,4) DEFAULT 0,
        topic_distribution JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_generator_alerts_type_severity 
        ON generator_alerts(type, severity, timestamp)
      `,
      `
      CREATE INDEX IF NOT EXISTS idx_generator_metrics_timestamp 
        ON generator_metrics(timestamp)
      `,
    ];

    for (const tableQuery of tables) {
      await this.db.query(tableQuery);
    }
  }

  /**
   * Start monitoring process
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Monitor every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      await this.collectMetrics();
      await this.checkAlertConditions();
      await this.updateRealtimeStats();
    }, 30000);

    // Cleanup old metrics every hour
    setInterval(async () => {
      await this.cleanupOldMetrics();
    }, 3600000);

    logger.info('Question generator monitoring started');
  }

  /**
   * Stop monitoring process
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
    logger.info('Question generator monitoring stopped');
  }

  /**
   * Collect performance metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const status = await questionGeneratorService.getGeneratorStatus();
      const health = await questionGeneratorService.healthCheck();
      
      // Calculate metrics
      const totalPools = status.poolStatus.length;
      const healthyPools = status.poolStatus.filter(p => 
        !p.isStale && p.currentSize >= p.targetSize * 0.8
      ).length;
      
      const poolUtilization = totalPools > 0 ? healthyPools / totalPools : 0;
      
      const totalRequests = status.queueStatus.completed + status.queueStatus.failed;
      const successRate = totalRequests > 0 ? 
        status.queueStatus.completed / totalRequests : 1;

      // Calculate requests per minute from recent queue activity
      const recentRequestsResult = await this.db.query(`
        SELECT COUNT(*) as count 
        FROM generation_queue 
        WHERE created_at > NOW() - INTERVAL '1 minute'
      `);
      const requestsPerMinute = parseInt(recentRequestsResult.rows[0]?.count || '0');

      // Calculate average response time from analytics
      const avgResponseTime = status.analytics.length > 0 ?
        status.analytics.reduce((sum, a) => sum + a.averageResponseTime, 0) / status.analytics.length :
        0;

      // Get topic distribution
      const topicDistribution: Record<string, number> = {};
      for (const analytic of status.analytics) {
        const key = `${analytic.topic}:${analytic.difficulty}`;
        topicDistribution[key] = analytic.usageFrequency;
      }

      // Get rate limit hits from Redis
      const rateLimitHits = await this.getRateLimitHitsLastMinute();

      const metrics: PerformanceMetrics = {
        timestamp: new Date(),
        requestsPerMinute,
        averageResponseTime: Math.round(avgResponseTime),
        successRate,
        queueLength: health.queueLength,
        poolUtilization,
        rateLimitHits,
        errorRate: 1 - successRate,
        topicDistribution,
      };

      // Store metrics
      await this.storeMetrics(metrics);
      this.performanceHistory.push(metrics);

      // Keep only last 100 metrics in memory
      if (this.performanceHistory.length > 100) {
        this.performanceHistory = this.performanceHistory.slice(-100);
      }

      this.emit('metrics', metrics);
    } catch (error) {
      logger.error('Error collecting metrics:', error);
    }
  }

  /**
   * Check for alert conditions
   */
  private async checkAlertConditions(): Promise<void> {
    try {
      const status = await questionGeneratorService.getGeneratorStatus();
      const health = await questionGeneratorService.healthCheck();

      // Check pool levels
      for (const pool of status.poolStatus) {
        const utilizationPercent = pool.targetSize > 0 ? 
          (pool.currentSize / pool.targetSize) * 100 : 0;

        if (utilizationPercent < 20) {
          await this.createAlert({
            type: 'pool_low',
            severity: 'critical',
            message: `Question pool critically low: ${pool.topic} (${pool.difficulty}) at ${utilizationPercent.toFixed(1)}%`,
            data: { pool, utilization: utilizationPercent }
          });
        } else if (utilizationPercent < 50) {
          await this.createAlert({
            type: 'pool_low',
            severity: 'warning',
            message: `Question pool low: ${pool.topic} (${pool.difficulty}) at ${utilizationPercent.toFixed(1)}%`,
            data: { pool, utilization: utilizationPercent }
          });
        }
      }

      // Check queue backup
      if (health.queueLength > 50) {
        await this.createAlert({
          type: 'queue_backup',
          severity: 'warning',
          message: `Generation queue backed up with ${health.queueLength} items`,
          data: { queueLength: health.queueLength, queueStatus: status.queueStatus }
        });
      } else if (health.queueLength > 100) {
        await this.createAlert({
          type: 'queue_backup',
          severity: 'error',
          message: `Generation queue severely backed up with ${health.queueLength} items`,
          data: { queueLength: health.queueLength, queueStatus: status.queueStatus }
        });
      }

      // Check quality decline
      const recentAnalytics = status.analytics.filter(a => 
        a.lastGenerated && new Date(a.lastGenerated) > new Date(Date.now() - 3600000) // Last hour
      );

      if (recentAnalytics.length > 0) {
        const avgQuality = recentAnalytics.reduce((sum, a) => sum + (a.averageQuality || 0), 0) / recentAnalytics.length;
        
        if (avgQuality < 0.6) {
          await this.createAlert({
            type: 'quality_decline',
            severity: 'warning',
            message: `Question quality declining: average ${(avgQuality * 100).toFixed(1)}%`,
            data: { averageQuality: avgQuality, recentAnalytics }
          });
        }
      }

      // Check error rates
      const recentMetrics = this.performanceHistory.slice(-10); // Last 10 metrics (5 minutes)
      if (recentMetrics.length > 0) {
        const avgErrorRate = recentMetrics.reduce((sum, m) => sum + m.errorRate, 0) / recentMetrics.length;
        
        if (avgErrorRate > 0.2) {
          await this.createAlert({
            type: 'service_error',
            severity: 'error',
            message: `High error rate: ${(avgErrorRate * 100).toFixed(1)}%`,
            data: { errorRate: avgErrorRate, recentMetrics }
          });
        }
      }

      // Check service health
      if (health.status === 'unhealthy') {
        await this.createAlert({
          type: 'service_error',
          severity: 'critical',
          message: `Service unhealthy: ${health.lastError || 'Unknown error'}`,
          data: health
        });
      }

    } catch (error) {
      logger.error('Error checking alert conditions:', error);
    }
  }

  /**
   * Update realtime statistics
   */
  private async updateRealtimeStats(): Promise<void> {
    try {
      const status = await questionGeneratorService.getGeneratorStatus();
      const health = await questionGeneratorService.healthCheck();

      const poolsBelow50 = status.poolStatus.filter(p => 
        p.targetSize > 0 && (p.currentSize / p.targetSize) < 0.5
      ).length;

      const poolsBelow20 = status.poolStatus.filter(p => 
        p.targetSize > 0 && (p.currentSize / p.targetSize) < 0.2
      ).length;

      // Get rate limited users count
      const rateLimitedUsers = await this.getRateLimitedUsersCount();

      // Get recent error count
      const errorCount = await this.getRecentErrorCount();

      const realtimeStats: RealtimeStats = {
        activeRequests: status.queueStatus.processing,
        queueLength: health.queueLength,
        poolsBelow50Percent: poolsBelow50,
        poolsBelow20Percent: poolsBelow20,
        rateLimitedUsers,
        errorCount,
        lastUpdated: new Date(),
      };

      // Cache in Redis
      await this.redis.setex(this.REALTIME_KEY, 60, JSON.stringify(realtimeStats));

      this.emit('realtimeStats', realtimeStats);
    } catch (error) {
      logger.error('Error updating realtime stats:', error);
    }
  }

  /**
   * Create a new alert
   */
  private async createAlert(alertData: {
    type: GeneratorAlert['type'];
    severity: GeneratorAlert['severity'];
    message: string;
    data: any;
  }): Promise<GeneratorAlert> {
    // Check if similar alert already exists and is not resolved
    const existingAlert = Array.from(this.alerts.values()).find(alert => 
      alert.type === alertData.type &&
      alert.severity === alertData.severity &&
      !alert.resolvedAt &&
      alert.message === alertData.message
    );

    if (existingAlert) {
      return existingAlert; // Don't create duplicate alerts
    }

    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const alert: GeneratorAlert = {
      id: alertId,
      type: alertData.type,
      severity: alertData.severity,
      message: alertData.message,
      data: alertData.data,
      timestamp: new Date(),
      acknowledged: false,
    };

    // Store in database
    await this.db.query(`
      INSERT INTO generator_alerts 
      (id, type, severity, message, data, timestamp, acknowledged)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      alert.id,
      alert.type,
      alert.severity,
      alert.message,
      JSON.stringify(alert.data),
      alert.timestamp,
      alert.acknowledged,
    ]);

    // Cache in memory
    this.alerts.set(alertId, alert);

    // Cache in Redis
    await this.redis.setex(`${this.ALERTS_PREFIX}${alertId}`, 86400, JSON.stringify(alert));

    // Emit alert event
    this.emit('alert', alert);

    logger.warn(`Alert created: [${alert.severity.toUpperCase()}] ${alert.message}`);
    return alert;
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy?: string): Promise<boolean> {
    try {
      const alert = this.alerts.get(alertId);
      if (!alert || alert.acknowledged) {
        return false;
      }

      alert.acknowledged = true;

      // Update database
      await this.db.query(
        'UPDATE generator_alerts SET acknowledged = TRUE WHERE id = $1',
        [alertId]
      );

      // Update cache
      await this.redis.setex(`${this.ALERTS_PREFIX}${alertId}`, 86400, JSON.stringify(alert));

      this.emit('alertAcknowledged', { alert, acknowledgedBy });
      return true;
    } catch (error) {
      logger.error('Error acknowledging alert:', error);
      return false;
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, resolvedBy?: string): Promise<boolean> {
    try {
      const alert = this.alerts.get(alertId);
      if (!alert || alert.resolvedAt) {
        return false;
      }

      alert.resolvedAt = new Date();

      // Update database
      await this.db.query(
        'UPDATE generator_alerts SET resolved_at = CURRENT_TIMESTAMP WHERE id = $1',
        [alertId]
      );

      // Update cache
      await this.redis.setex(`${this.ALERTS_PREFIX}${alertId}`, 86400, JSON.stringify(alert));

      this.emit('alertResolved', { alert, resolvedBy });
      return true;
    } catch (error) {
      logger.error('Error resolving alert:', error);
      return false;
    }
  }

  /**
   * Get current alerts
   */
  async getActiveAlerts(): Promise<GeneratorAlert[]> {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.resolvedAt)
      .sort((a, b) => {
        // Sort by severity, then timestamp
        const severityOrder = { critical: 3, error: 2, warning: 1, info: 0 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.timestamp.getTime() - a.timestamp.getTime();
      });
  }

  /**
   * Get alert history
   */
  async getAlertHistory(limit: number = 50): Promise<GeneratorAlert[]> {
    const result = await this.db.query(`
      SELECT * FROM generator_alerts 
      ORDER BY timestamp DESC 
      LIMIT $1
    `, [limit]);

    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      message: row.message,
      data: row.data,
      timestamp: row.timestamp,
      acknowledged: row.acknowledged,
      resolvedAt: row.resolved_at,
    }));
  }

  /**
   * Get performance metrics history
   */
  async getMetricsHistory(hours: number = 24): Promise<PerformanceMetrics[]> {
    const result = await this.db.query(`
      SELECT * FROM generator_metrics 
      WHERE timestamp > NOW() - INTERVAL '${hours} hours'
      ORDER BY timestamp ASC
    `);

    return result.rows.map(row => ({
      timestamp: row.timestamp,
      requestsPerMinute: row.requests_per_minute,
      averageResponseTime: row.average_response_time,
      successRate: parseFloat(row.success_rate),
      queueLength: row.queue_length,
      poolUtilization: parseFloat(row.pool_utilization),
      rateLimitHits: row.rate_limit_hits,
      errorRate: parseFloat(row.error_rate),
      topicDistribution: row.topic_distribution,
    }));
  }

  /**
   * Get realtime statistics
   */
  async getRealtimeStats(): Promise<RealtimeStats | null> {
    try {
      const cached = await this.redis.get(this.REALTIME_KEY);
      if (!cached) return null;

      const stats = JSON.parse(cached);
      return {
        ...stats,
        lastUpdated: new Date(stats.lastUpdated),
      };
    } catch (error) {
      logger.error('Error getting realtime stats:', error);
      return null;
    }
  }

  /**
   * Store performance metrics in database
   */
  private async storeMetrics(metrics: PerformanceMetrics): Promise<void> {
    const metricsId = `metrics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.db.query(`
      INSERT INTO generator_metrics 
      (id, timestamp, requests_per_minute, average_response_time, success_rate, 
       queue_length, pool_utilization, rate_limit_hits, error_rate, topic_distribution)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      metricsId,
      metrics.timestamp,
      metrics.requestsPerMinute,
      metrics.averageResponseTime,
      metrics.successRate,
      metrics.queueLength,
      metrics.poolUtilization,
      metrics.rateLimitHits,
      metrics.errorRate,
      JSON.stringify(metrics.topicDistribution),
    ]);
  }

  /**
   * Load existing alerts from database
   */
  private async loadExistingAlerts(): Promise<void> {
    const result = await this.db.query(`
      SELECT * FROM generator_alerts 
      WHERE resolved_at IS NULL 
      ORDER BY timestamp DESC
    `);

    for (const row of result.rows) {
      const alert: GeneratorAlert = {
        id: row.id,
        type: row.type,
        severity: row.severity,
        message: row.message,
        data: row.data,
        timestamp: row.timestamp,
        acknowledged: row.acknowledged,
        resolvedAt: row.resolved_at,
      };
      
      this.alerts.set(alert.id, alert);
    }

    logger.info(`Loaded ${result.rows.length} active alerts`);
  }

  /**
   * Cleanup old metrics to prevent database bloat
   */
  private async cleanupOldMetrics(): Promise<void> {
    try {
      // Keep metrics for 7 days
      await this.db.query(`
        DELETE FROM generator_metrics 
        WHERE timestamp < NOW() - INTERVAL '7 days'
      `);

      // Keep resolved alerts for 30 days
      await this.db.query(`
        DELETE FROM generator_alerts 
        WHERE resolved_at IS NOT NULL 
        AND resolved_at < NOW() - INTERVAL '30 days'
      `);

      logger.info('Cleaned up old monitoring data');
    } catch (error) {
      logger.error('Error cleaning up old metrics:', error);
    }
  }

  /**
   * Get rate limit hits in the last minute
   */
  private async getRateLimitHitsLastMinute(): Promise<number> {
    // This would need to be implemented based on how rate limiting is tracked
    // For now, return 0 as placeholder
    return 0;
  }

  /**
   * Get count of currently rate limited users
   */
  private async getRateLimitedUsersCount(): Promise<number> {
    try {
      const keys = await this.redis.keys('rate_limit:user:*');
      let rateLimitedCount = 0;

      for (const key of keys) {
        const limitInfo = await this.redis.get(key);
        if (limitInfo) {
          const parsed = JSON.parse(limitInfo);
          if (parsed.isLimited) {
            rateLimitedCount++;
          }
        }
      }

      return rateLimitedCount;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get recent error count
   */
  private async getRecentErrorCount(): Promise<number> {
    try {
      const result = await this.db.query(`
        SELECT COUNT(*) as count 
        FROM generation_queue 
        WHERE status = 'failed' 
        AND created_at > NOW() - INTERVAL '5 minutes'
      `);

      return parseInt(result.rows[0]?.count || '0');
    } catch (error) {
      return 0;
    }
  }
}

export const questionGeneratorMonitor = new QuestionGeneratorMonitorService(
  // These will be injected when the service is instantiated
  {} as Pool,
  {} as Redis
);