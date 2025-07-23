import { createHash, randomBytes } from 'crypto';
import type { VRFResult } from '../types/index.js';

export class VRF {
  private static readonly HASH_ALGORITHM = 'sha256';

  /**
   * Generate a verifiable random value with proof
   * @param seed - Optional seed for deterministic randomness
   * @returns VRFResult containing the random value, proof, and seed
   */
  static generate(seed?: string): VRFResult {
    // Generate or use provided seed
    const actualSeed = seed || randomBytes(32).toString('hex');
    
    // Create the random value using the seed
    const valueHash = createHash(this.HASH_ALGORITHM);
    valueHash.update(actualSeed);
    valueHash.update('value');
    const value = valueHash.digest('hex');

    // Create the proof
    const proofHash = createHash(this.HASH_ALGORITHM);
    proofHash.update(actualSeed);
    proofHash.update('proof');
    proofHash.update(value);
    const proof = proofHash.digest('hex');

    return {
      value,
      proof,
      seed: actualSeed,
      timestamp: Date.now(),
    };
  }

  /**
   * Verify a VRF result
   * @param result - The VRF result to verify
   * @returns true if the proof is valid, false otherwise
   */
  static verify(result: VRFResult): boolean {
    // Recreate the value from the seed
    const valueHash = createHash(this.HASH_ALGORITHM);
    valueHash.update(result.seed);
    valueHash.update('value');
    const expectedValue = valueHash.digest('hex');

    // Check if the value matches
    if (expectedValue !== result.value) {
      return false;
    }

    // Recreate the proof
    const proofHash = createHash(this.HASH_ALGORITHM);
    proofHash.update(result.seed);
    proofHash.update('proof');
    proofHash.update(result.value);
    const expectedProof = proofHash.digest('hex');

    // Check if the proof matches
    return expectedProof === result.proof;
  }

  /**
   * Generate a random number within a range using VRF
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @param seed - Optional seed
   * @returns Random number and VRF result
   */
  static generateRandomNumber(
    min: number,
    max: number,
    seed?: string,
  ): { number: number; vrf: VRFResult } {
    const vrf = this.generate(seed);
    
    // Convert hex value to a number between 0 and 1
    const hexValue = vrf.value.substring(0, 8); // Use first 8 hex chars
    const numericValue = parseInt(hexValue, 16);
    const normalizedValue = numericValue / 0xffffffff; // Normalize to 0-1
    
    // Scale to the desired range
    const range = max - min + 1;
    const randomNumber = Math.floor(normalizedValue * range) + min;

    return { number: randomNumber, vrf };
  }
}

// Export a simple function for legacy compatibility
export function generateVRF(seed?: string): VRFResult {
  return VRF.generate(seed);
}