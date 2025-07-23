import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { VRF } from '../utils/vrf';
import { LotteryProgramClient } from '../blockchain/lottery-sdk';

export interface FallbackVRFConfig {
  maxRetries: number;
  retryDelay: number;
  useChainData: boolean;
  useCombinedSources: boolean;
}

export class VRFFallbackService {
  private config: FallbackVRFConfig;
  
  constructor(
    private connection: Connection,
    private lotterySdk: LotteryProgramClient,
    config?: Partial<FallbackVRFConfig>
  ) {
    this.config = {
      maxRetries: 3,
      retryDelay: 2000,
      useChainData: true,
      useCombinedSources: true,
      ...config,
    };
  }
  
  /**
   * Process elimination with fallback mechanisms
   */
  async processEliminationWithFallback(
    gameId: string,
    round: number,
    vrfOracle: Keypair
  ): Promise<{
    success: boolean;
    method: 'orao' | 'fallback' | 'local';
    transactionId?: string;
    drawnNumber?: number;
    error?: string;
  }> {
    // Try ORAO VRF first
    try {
      logger.info(`Attempting ORAO VRF for game ${gameId}, round ${round}`);
      
      const result = await this.lotterySdk.processEliminationWithOrao(gameId, round);
      
      if (result.fulfilled && result.processedTx) {
        logger.info(`ORAO VRF successful for game ${gameId}`);
        return {
          success: true,
          method: 'orao',
          transactionId: result.processedTx,
        };
      }
    } catch (error) {
      logger.error(`ORAO VRF failed for game ${gameId}:`, error);
    }
    
    // Fallback to chain-based randomness
    if (this.config.useChainData) {
      try {
        logger.info(`Attempting chain-based fallback for game ${gameId}`);
        
        const drawnNumber = await this.generateChainBasedRandom(gameId, round);
        const txId = await this.submitFallbackVrf(gameId, round, drawnNumber, vrfOracle);
        
        return {
          success: true,
          method: 'fallback',
          transactionId: txId,
          drawnNumber,
        };
      } catch (error) {
        logger.error(`Chain-based fallback failed for game ${gameId}:`, error);
      }
    }
    
    // Last resort: local VRF
    try {
      logger.info(`Using local VRF as last resort for game ${gameId}`);
      
      const localVrf = VRF.generate(`${gameId}-${round}-${Date.now()}`);
      const drawnNumber = await this.vrfToNumber(localVrf.value, gameId);
      const txId = await this.submitFallbackVrf(gameId, round, drawnNumber, vrfOracle);
      
      return {
        success: true,
        method: 'local',
        transactionId: txId,
        drawnNumber,
      };
    } catch (error) {
      logger.error(`Local VRF failed for game ${gameId}:`, error);
      
      return {
        success: false,
        method: 'local',
        error: error.message,
      };
    }
  }
  
  /**
   * Generate random number using chain data
   */
  private async generateChainBasedRandom(gameId: string, round: number): Promise<number> {
    // Get recent blockhashes
    const recentBlockhash = await this.connection.getLatestBlockhash();
    const slot = await this.connection.getSlot();
    
    // Get some entropy from recent transactions
    const signatures = await this.connection.getSignaturesForAddress(
      this.lotterySdk['program'].programId,
      { limit: 10 }
    );
    
    // Combine sources
    const combinedData = [
      gameId,
      round.toString(),
      recentBlockhash.blockhash,
      slot.toString(),
      ...signatures.map(sig => sig.signature),
    ].join('-');
    
    // Generate hash
    const hash = createHash('sha256').update(combinedData).digest('hex');
    
    // Convert to number in game range
    return await this.vrfToNumber(hash, gameId);
  }
  
  /**
   * Convert VRF value to number within game range
   */
  private async vrfToNumber(vrfValue: string, gameId: string): Promise<number> {
    const gameState = await this.lotterySdk.getGame(gameId);
    if (!gameState) {
      throw new Error('Game not found');
    }
    
    // Use first 8 hex chars
    const hexValue = vrfValue.substring(0, 8);
    const numericValue = parseInt(hexValue, 16);
    const normalizedValue = numericValue / 0xffffffff;
    
    // Scale to game range
    const range = gameState.numberRange.max - gameState.numberRange.min + 1;
    return Math.floor(normalizedValue * range) + gameState.numberRange.min;
  }
  
  /**
   * Submit fallback VRF result
   */
  private async submitFallbackVrf(
    gameId: string,
    round: number,
    drawnNumber: number,
    vrfOracle: Keypair
  ): Promise<string> {
    // Generate deterministic random value from drawn number
    const seed = `${gameId}-${round}-${drawnNumber}`;
    const randomValue = createHash('sha256').update(seed).digest();
    
    // Create simple proof
    const proof = Buffer.concat([
      Buffer.from('fallback'),
      randomValue,
      Buffer.from([drawnNumber]),
    ]);
    
    // Submit using the legacy VRF method
    const tx = await this.lotterySdk['program'].methods
      .submitVrf(
        gameId,
        round,
        Array.from(randomValue),
        proof
      )
      .accounts({
        vrfOracle: vrfOracle.publicKey,
        // Other accounts would be added by the SDK
      })
      .signers([vrfOracle])
      .rpc();
    
    logger.info(`Fallback VRF submitted for game ${gameId}, tx: ${tx}`);
    return tx;
  }
  
  /**
   * Monitor and handle VRF requests with retries
   */
  async monitorVrfWithRetries(
    gameId: string,
    round: number,
    vrfOracle: Keypair
  ): Promise<{
    success: boolean;
    attempts: number;
    finalMethod: string;
  }> {
    let attempts = 0;
    
    while (attempts < this.config.maxRetries) {
      attempts++;
      
      const result = await this.processEliminationWithFallback(gameId, round, vrfOracle);
      
      if (result.success) {
        return {
          success: true,
          attempts,
          finalMethod: result.method,
        };
      }
      
      // Wait before retry
      if (attempts < this.config.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
      }
    }
    
    return {
      success: false,
      attempts,
      finalMethod: 'none',
    };
  }
  
  /**
   * Batch process multiple VRF requests
   */
  async batchProcessVrf(
    requests: Array<{ gameId: string; round: number }>,
    vrfOracle: Keypair
  ): Promise<Map<string, { success: boolean; method: string }>> {
    const results = new Map<string, { success: boolean; method: string }>();
    
    // Process in parallel with concurrency limit
    const concurrencyLimit = 3;
    const chunks = [];
    
    for (let i = 0; i < requests.length; i += concurrencyLimit) {
      chunks.push(requests.slice(i, i + concurrencyLimit));
    }
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (req) => {
        const key = `${req.gameId}-${req.round}`;
        try {
          const result = await this.processEliminationWithFallback(
            req.gameId,
            req.round,
            vrfOracle
          );
          results.set(key, { success: result.success, method: result.method });
        } catch (error) {
          results.set(key, { success: false, method: 'error' });
        }
      });
      
      await Promise.all(promises);
    }
    
    return results;
  }
  
  /**
   * Validate fallback randomness quality
   */
  validateRandomnessQuality(
    samples: number[],
    expectedRange: { min: number; max: number }
  ): {
    valid: boolean;
    issues: string[];
    stats: {
      mean: number;
      stdDev: number;
      distribution: Map<number, number>;
    };
  } {
    const issues: string[] = [];
    
    // Check if all numbers are in range
    const outOfRange = samples.filter(n => n < expectedRange.min || n > expectedRange.max);
    if (outOfRange.length > 0) {
      issues.push(`${outOfRange.length} samples out of range`);
    }
    
    // Calculate statistics
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    
    // Check distribution
    const distribution = new Map<number, number>();
    samples.forEach(n => {
      distribution.set(n, (distribution.get(n) || 0) + 1);
    });
    
    // Expected values for uniform distribution
    const expectedMean = (expectedRange.min + expectedRange.max) / 2;
    const range = expectedRange.max - expectedRange.min + 1;
    const expectedStdDev = Math.sqrt((range * range - 1) / 12);
    
    // Check if mean is reasonable
    if (Math.abs(mean - expectedMean) > expectedStdDev) {
      issues.push('Mean deviates significantly from expected');
    }
    
    // Check if standard deviation is reasonable
    if (Math.abs(stdDev - expectedStdDev) > expectedStdDev * 0.2) {
      issues.push('Standard deviation deviates from expected');
    }
    
    // Check for obvious patterns
    const frequencies = Array.from(distribution.values());
    const maxFreq = Math.max(...frequencies);
    const minFreq = Math.min(...frequencies);
    
    if (maxFreq > minFreq * 3 && samples.length > 100) {
      issues.push('Uneven distribution detected');
    }
    
    return {
      valid: issues.length === 0,
      issues,
      stats: {
        mean,
        stdDev,
        distribution,
      },
    };
  }
}

export default VRFFallbackService;