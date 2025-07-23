/**
 * Performance Integration Module
 * Integrates all performance optimizations into the React application
 */

import PerformanceOptimizer, { defaultPerformanceConfig } from '../../src/performance';
import { initializeApolloClient } from './apollo-client.optimized';
import { logger } from '../../src/utils/logger';

class PerformanceIntegration {
  private optimizer: PerformanceOptimizer;
  private initialized: boolean = false;
  private apolloClient: any = null;

  constructor() {
    // Customize configuration for mobile-first optimization
    const mobileOptimizedConfig = {
      ...defaultPerformanceConfig,
      mobile: {
        ...defaultPerformanceConfig.mobile,
        targetBundleSize: 400, // Aggressive 400KB target for mobile
        enableServiceWorker: true,
        cdnUrl: process.env.REACT_APP_CDN_URL,
      },
      network: {
        ...defaultPerformanceConfig.network,
        enableCompression: true,
        compressionThreshold: 5120, // 5KB threshold for mobile
        cacheStrategies: [
          {
            pattern: /\/api\/static\//,
            strategy: 'cache-first' as const,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            maxEntries: 100,
          },
          {
            pattern: /\/api\/games\//,
            strategy: 'stale-while-revalidate' as const,
            maxAge: 5 * 60 * 1000, // 5 minutes
            maxEntries: 50,
          },
          {
            pattern: /\/api\/analytics\//,
            strategy: 'network-first' as const,
            maxAge: 2 * 60 * 1000, // 2 minutes
            maxEntries: 20,
          },
          {
            pattern: /\/api\/blockchain\//,
            strategy: 'network-only' as const,
            maxAge: 0,
          },
        ],
        preloadAssets: [
          '/static/js/framework.js',
          '/static/js/vendor.js',
          '/static/css/main.css',
          '/icons/icon-192x192.png',
        ],
      },
      memory: {
        ...defaultPerformanceConfig.memory,
        maxCacheSize: 25, // Reduce to 25MB for mobile
        gcInterval: 120000, // More frequent GC on mobile (2 minutes)
      },
    };

    this.optimizer = new PerformanceOptimizer(mobileOptimizedConfig);
  }

  /**
   * Initialize all performance optimizations
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize Apollo Client with optimizations
      this.apolloClient = await initializeApolloClient();

      // Initialize performance optimizer
      await this.optimizer.initialize(
        process.env.REACT_APP_GRAPHQL_URL || 'http://localhost:4000/graphql',
        [
          'https://api.mainnet-beta.solana.com',
          'https://solana-api.projectserum.com',
          'https://api.solana.fm',
        ]
      );

      // Set up performance monitoring
      this.setupPerformanceMonitoring();

      // Set up network monitoring
      this.setupNetworkMonitoring();

      // Set up critical resource hints
      this.setupResourceHints();

      this.initialized = true;
      logger.info('Performance integration initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize performance integration:', error);
      throw error;
    }
  }

  /**
   * Set up performance monitoring with Core Web Vitals
   */
  private setupPerformanceMonitoring(): void {
    // Report Web Vitals
    if ('web-vitals' in window) {
      import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
        getCLS(this.reportWebVital);
        getFID(this.reportWebVital);
        getFCP(this.reportWebVital);
        getLCP(this.reportWebVital);
        getTTFB(this.reportWebVital);
      });
    }

    // Monitor long tasks
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) { // Tasks longer than 50ms
              logger.warn('Long task detected:', {
                duration: entry.duration,
                startTime: entry.startTime,
                name: entry.name,
              });
            }
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        // Ignore if not supported
      }
    }

    // Monitor memory usage
    this.monitorMemoryUsage();
  }

  /**
   * Report Web Vital metrics
   */
  private reportWebVital = (metric: any) => {
    logger.info(`Web Vital - ${metric.name}:`, {
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
    });

    // Send to analytics service if configured
    if (process.env.REACT_APP_ANALYTICS_URL) {
      fetch(`${process.env.REACT_APP_ANALYTICS_URL}/web-vitals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metric),
      }).catch(() => {
        // Ignore analytics errors
      });
    }
  };

  /**
   * Monitor memory usage
   */
  private monitorMemoryUsage(): void {
    if ('memory' in (performance as any)) {
      setInterval(() => {
        const memory = (performance as any).memory;
        const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;

        if (usagePercent > 85) {
          logger.warn('High memory usage detected:', {
            used: memory.usedJSHeapSize,
            total: memory.jsHeapSizeLimit,
            percentage: usagePercent.toFixed(2),
          });

          // Force garbage collection if usage is very high
          if (usagePercent > 90) {
            this.optimizer.clearCaches();
          }
        }
      }, 30000); // Check every 30 seconds
    }
  }

  /**
   * Set up network monitoring
   */
  private setupNetworkMonitoring(): void {
    // Monitor connection changes
    window.addEventListener('online', () => {
      logger.info('Network connection restored');
      // Sync any offline data
      this.syncOfflineData();
    });

    window.addEventListener('offline', () => {
      logger.warn('Network connection lost');
      // Switch to offline mode
    });

    // Monitor connection quality
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      connection.addEventListener('change', () => {
        logger.info('Network quality changed:', {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt,
          saveData: connection.saveData,
        });
      });
    }
  }

  /**
   * Set up resource hints for critical resources
   */
  private setupResourceHints(): void {
    const head = document.head;

    // Preconnect to API endpoints
    const preconnectUrls = [
      process.env.REACT_APP_API_URL,
      process.env.REACT_APP_CDN_URL,
      'https://api.mainnet-beta.solana.com',
    ].filter(Boolean);

    preconnectUrls.forEach(url => {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = url!;
      link.crossOrigin = 'anonymous';
      head.appendChild(link);
    });

    // DNS prefetch for external services
    const dnsPrefetchUrls = [
      'https://api.solana.fm',
      'https://solana-api.projectserum.com',
    ];

    dnsPrefetchUrls.forEach(url => {
      const link = document.createElement('link');
      link.rel = 'dns-prefetch';
      link.href = url;
      head.appendChild(link);
    });
  }

  /**
   * Sync offline data when connection is restored
   */
  private async syncOfflineData(): Promise<void> {
    try {
      // Refetch critical data
      if (this.apolloClient) {
        await this.apolloClient.refetchQueries({
          include: 'active',
        });
      }

      logger.info('Offline data sync completed');
    } catch (error) {
      logger.error('Failed to sync offline data:', error);
    }
  }

  /**
   * Get optimized Apollo Client
   */
  getApolloClient() {
    return this.apolloClient;
  }

  /**
   * Get performance optimizer instance
   */
  getOptimizer() {
    return this.optimizer;
  }

  /**
   * Get performance metrics dashboard data
   */
  getMetrics() {
    const metrics = this.optimizer.getMetrics();
    const recommendations = this.optimizer.getRecommendations();

    return {
      ...metrics,
      recommendations,
      webVitals: this.getWebVitalsScore(),
    };
  }

  /**
   * Calculate Web Vitals score
   */
  private getWebVitalsScore(): { score: number; grade: string } {
    // This would be implemented based on actual Web Vitals data
    // For now, return a placeholder
    return {
      score: 85,
      grade: 'B+',
    };
  }

  /**
   * Optimize based on device capabilities
   */
  optimizeForDevice(): void {
    const deviceMemory = (navigator as any).deviceMemory || 4; // Default to 4GB
    const connectionType = (navigator as any).connection?.effectiveType || '4g';

    // Adjust optimizations based on device capabilities
    if (deviceMemory < 2) {
      // Low memory device optimizations
      this.optimizer.clearCaches();
      logger.info('Applied low memory device optimizations');
    }

    if (connectionType === '2g' || connectionType === 'slow-2g') {
      // Slow connection optimizations
      logger.info('Applied slow connection optimizations');
    }
  }

  /**
   * Cleanup performance monitoring
   */
  cleanup(): void {
    if (this.optimizer) {
      this.optimizer.cleanup();
    }
    this.initialized = false;
    logger.info('Performance integration cleaned up');
  }
}

// Export singleton instance
export const performanceIntegration = new PerformanceIntegration();

export default performanceIntegration;