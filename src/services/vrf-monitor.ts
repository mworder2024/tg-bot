import { Connection, PublicKey } from '@solana/web3.js';
import { OraoVRFService } from '../utils/orao-vrf';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface VRFCostAlert {
  type: 'high_cost' | 'budget_exceeded' | 'rate_limit';
  message: string;
  currentCost: number;
  threshold: number;
  gameId?: string;
}

export interface VRFMetrics {
  totalRequests: number;
  fulfilledRequests: number;
  failedRequests: number;
  totalCostSOL: number;
  averageResponseTime: number;
  successRate: number;
}

export class VRFMonitorService extends EventEmitter {
  private oraoVrf: OraoVRFService;
  private metrics: VRFMetrics;
  private costThresholdSOL: number;
  private budgetLimitSOL: number;
  private totalSpentSOL: number;
  
  constructor(
    private connection: Connection,
    private programId: PublicKey,
    cluster: 'mainnet-beta' | 'devnet' = 'devnet',
    costThresholdSOL: number = 0.01, // Alert if single request > 0.01 SOL
    budgetLimitSOL: number = 1.0 // Alert if total spending > 1 SOL
  ) {
    super();
    
    this.oraoVrf = new OraoVRFService(connection, programId, cluster);
    this.costThresholdSOL = costThresholdSOL;
    this.budgetLimitSOL = budgetLimitSOL;
    this.totalSpentSOL = 0;
    
    this.metrics = {
      totalRequests: 0,
      fulfilledRequests: 0,
      failedRequests: 0,
      totalCostSOL: 0,
      averageResponseTime: 0,
      successRate: 0,
    };
  }
  
  /**
   * Track a VRF request
   */
  async trackRequest(gameId: string): Promise<void> {
    this.metrics.totalRequests++;
    
    // Get current VRF fee
    const fee = await this.oraoVrf.getVrfFee();
    const feeSOL = fee / 1e9;
    
    // Update metrics
    this.metrics.totalCostSOL += feeSOL;
    this.totalSpentSOL += feeSOL;
    
    // Check cost alerts
    if (feeSOL > this.costThresholdSOL) {
      this.emitAlert({
        type: 'high_cost',
        message: `VRF request cost (${feeSOL} SOL) exceeds threshold`,
        currentCost: feeSOL,
        threshold: this.costThresholdSOL,
        gameId,
      });
    }
    
    if (this.totalSpentSOL > this.budgetLimitSOL) {
      this.emitAlert({
        type: 'budget_exceeded',
        message: `Total VRF spending (${this.totalSpentSOL} SOL) exceeds budget limit`,
        currentCost: this.totalSpentSOL,
        threshold: this.budgetLimitSOL,
      });
    }
    
    logger.info('VRF request tracked', {
      gameId,
      feeSOL,
      totalSpentSOL: this.totalSpentSOL,
      totalRequests: this.metrics.totalRequests,
    });
  }
  
  /**
   * Track fulfillment result
   */
  trackFulfillment(gameId: string, success: boolean, responseTime: number): void {
    if (success) {
      this.metrics.fulfilledRequests++;
    } else {
      this.metrics.failedRequests++;
    }
    
    // Update average response time
    const totalResponses = this.metrics.fulfilledRequests + this.metrics.failedRequests;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (totalResponses - 1) + responseTime) / totalResponses;
    
    // Update success rate
    this.metrics.successRate = this.metrics.fulfilledRequests / this.metrics.totalRequests;
    
    logger.info('VRF fulfillment tracked', {
      gameId,
      success,
      responseTime,
      averageResponseTime: this.metrics.averageResponseTime,
      successRate: this.metrics.successRate,
    });
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): VRFMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get cost analysis for a game
   */
  async analyzeCostsForGame(expectedRounds: number): Promise<{
    estimatedCost: number;
    estimatedCostSOL: number;
    withinBudget: boolean;
    remainingBudget: number;
    remainingBudgetSOL: number;
    recommendations: string[];
  }> {
    const costEstimate = await this.oraoVrf.estimateGameVrfCost(expectedRounds);
    const remainingBudget = this.budgetLimitSOL - this.totalSpentSOL;
    const withinBudget = costEstimate.totalCostSOL <= remainingBudget;
    
    const recommendations: string[] = [];
    
    if (!withinBudget) {
      recommendations.push('Game cost exceeds remaining budget. Consider reducing rounds or increasing budget.');
    }
    
    if (costEstimate.perRequestSOL > this.costThresholdSOL) {
      recommendations.push('Per-round cost is high. Consider batching VRF requests if possible.');
    }
    
    if (this.metrics.successRate < 0.95) {
      recommendations.push('VRF success rate is below 95%. Monitor network conditions.');
    }
    
    if (this.metrics.averageResponseTime > 5000) {
      recommendations.push('VRF response time is high. Consider implementing fallback mechanisms.');
    }
    
    return {
      estimatedCost: costEstimate.totalCostSOL * 1e9, // Convert SOL to lamports
      estimatedCostSOL: costEstimate.totalCostSOL,
      withinBudget,
      remainingBudget: remainingBudget * 1e9,
      remainingBudgetSOL: remainingBudget,
      recommendations,
    };
  }
  
  /**
   * Reset metrics (e.g., daily reset)
   */
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      fulfilledRequests: 0,
      failedRequests: 0,
      totalCostSOL: 0,
      averageResponseTime: 0,
      successRate: 0,
    };
    
    logger.info('VRF metrics reset');
  }
  
  /**
   * Reset budget tracking
   */
  resetBudget(): void {
    this.totalSpentSOL = 0;
    logger.info('VRF budget tracking reset');
  }
  
  /**
   * Emit cost alert
   */
  private emitAlert(alert: VRFCostAlert): void {
    this.emit('alert', alert);
    logger.warn('VRF cost alert', alert);
  }
  
  /**
   * Get optimization suggestions
   */
  getOptimizationSuggestions(): string[] {
    const suggestions: string[] = [];
    
    // Check if batching would help
    if (this.metrics.totalRequests > 10 && this.metrics.averageResponseTime < 3000) {
      suggestions.push('Consider implementing VRF request batching to reduce costs.');
    }
    
    // Check if caching would help
    if (this.metrics.totalRequests > 50) {
      suggestions.push('Implement VRF result caching for similar game configurations.');
    }
    
    // Check if fallback is needed
    if (this.metrics.failedRequests > 0) {
      suggestions.push('Implement fallback randomness mechanism for failed VRF requests.');
    }
    
    // Check cost efficiency
    const avgCostPerRequest = this.metrics.totalCostSOL / this.metrics.totalRequests;
    if (avgCostPerRequest > 0.002) {
      suggestions.push('Average cost per request is high. Review VRF usage patterns.');
    }
    
    return suggestions;
  }
  
  /**
   * Monitor VRF health
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];
    let healthy = true;
    
    try {
      // Check if ORAO service is accessible
      const fee = await this.oraoVrf.getVrfFee();
      if (fee <= 0) {
        issues.push('VRF fee is invalid');
        healthy = false;
      }
      
      // Check network state
      const networkState = await this.oraoVrf.getNetworkStateAccount();
      const accountInfo = await this.connection.getAccountInfo(networkState);
      if (!accountInfo) {
        issues.push('ORAO network state account not found');
        healthy = false;
      }
      
      // Check metrics
      if (this.metrics.successRate < 0.9 && this.metrics.totalRequests > 10) {
        issues.push('VRF success rate below 90%');
        healthy = false;
      }
      
      if (this.metrics.averageResponseTime > 10000) {
        issues.push('VRF response time exceeds 10 seconds');
        healthy = false;
      }
      
    } catch (error) {
      issues.push(`Health check error: ${error.message}`);
      healthy = false;
    }
    
    return { healthy, issues };
  }
}

export default VRFMonitorService;