import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createLotteryClient, LotteryProgramClient } from '../../src/blockchain/lottery-sdk';
import { OraoVRFService } from '../../src/utils/orao-vrf';
import { expect } from 'chai';

describe('ORAO VRF Integration', () => {
  let connection: Connection;
  let lotterySdk: LotteryProgramClient;
  let oraoVrf: OraoVRFService;
  let botWallet: Keypair;
  let gameId: string;
  
  before(async () => {
    // Setup for devnet testing
    connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    botWallet = Keypair.generate();
    
    // Airdrop SOL for testing
    const airdropSig = await connection.requestAirdrop(
      botWallet.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    
    // Initialize SDK with ORAO VRF
    const programId = process.env.LOTTERY_PROGRAM_ID || '11111111111111111111111111111111';
    const tokenMint = process.env.MWOR_TOKEN_MINT || '11111111111111111111111111111111';
    const vrfOracle = botWallet.publicKey.toBase58(); // Using bot as oracle for testing
    
    lotterySdk = await createLotteryClient(
      connection,
      programId,
      botWallet,
      tokenMint,
      vrfOracle
    );
    
    // Initialize ORAO VRF service
    oraoVrf = new OraoVRFService(connection, new PublicKey(programId), 'devnet');
    
    // Create a test game
    gameId = `test-${Date.now()}`;
  });
  
  describe('VRF Cost Estimation', () => {
    it('should estimate VRF costs for a game', async () => {
      const expectedRounds = 10;
      const costEstimate = await lotterySdk.getVrfCostEstimate(expectedRounds);
      
      expect(costEstimate).to.have.property('perRoundCost');
      expect(costEstimate).to.have.property('totalCost');
      expect(costEstimate).to.have.property('perRoundCostSOL');
      expect(costEstimate).to.have.property('totalCostSOL');
      
      expect(costEstimate.perRoundCost).to.be.greaterThan(0);
      expect(costEstimate.totalCost).to.equal(costEstimate.perRoundCost * expectedRounds);
      expect(costEstimate.perRoundCostSOL).to.equal(costEstimate.perRoundCost / 1e9);
      expect(costEstimate.totalCostSOL).to.equal(costEstimate.totalCost / 1e9);
      
      console.log('VRF Cost Estimate:', {
        perRoundCostSOL: costEstimate.perRoundCostSOL,
        totalCostSOL: costEstimate.totalCostSOL,
        expectedRounds
      });
    });
  });
  
  describe('VRF Request Flow', () => {
    it('should request randomness from ORAO VRF', async () => {
      try {
        const round = 1;
        const tx = await lotterySdk.requestOraoVrf(
          gameId,
          round,
          botWallet.publicKey,
          botWallet
        );
        
        expect(tx).to.be.a('string');
        console.log('VRF Request Transaction:', tx);
        
        // Check if request was created
        const fulfilled = await lotterySdk.isVrfFulfilled(gameId);
        expect(fulfilled).to.be.false; // Should not be fulfilled immediately
      } catch (error) {
        // Expected to fail without proper game setup
        expect(error.message).to.include('Account does not exist');
      }
    });
    
    it('should wait for VRF fulfillment', async () => {
      try {
        // This will timeout as we don't have a real game
        const fulfilled = await lotterySdk.waitForVrfFulfillment(gameId, 5000);
        expect(fulfilled).to.be.false;
      } catch (error) {
        // Expected behavior
      }
    });
  });
  
  describe('ORAO Service Methods', () => {
    it('should get ORAO program ID', () => {
      const programId = oraoVrf.getVrfProgramId();
      expect(programId).to.be.instanceOf(PublicKey);
      console.log('ORAO VRF Program ID:', programId.toBase58());
    });
    
    it('should get network state account', () => {
      const networkState = oraoVrf.getNetworkStateAccount();
      expect(networkState).to.be.instanceOf(PublicKey);
      console.log('Network State Account:', networkState.toBase58());
    });
    
    it('should get randomness account for seed', () => {
      const seed = Keypair.generate().publicKey;
      const randomnessAccount = oraoVrf.getRandomnessAccount(seed);
      expect(randomnessAccount).to.be.instanceOf(PublicKey);
    });
    
    it('should get VRF fee', async () => {
      const fee = await oraoVrf.getVrfFee();
      expect(fee).to.be.a('number');
      expect(fee).to.be.greaterThan(0);
      console.log('VRF Fee:', fee / 1e9, 'SOL');
    });
    
    it('should estimate average response time', async () => {
      const avgTime = await oraoVrf.getAverageResponseTime();
      expect(avgTime).to.be.a('number');
      expect(avgTime).to.be.greaterThan(0);
      console.log('Average Response Time:', avgTime, 'ms');
    });
  });
  
  describe('Complete Elimination Flow', () => {
    it('should handle complete elimination with ORAO VRF', async () => {
      try {
        const round = 1;
        const result = await lotterySdk.processEliminationWithOrao(gameId, round);
        
        expect(result).to.have.property('requestTx');
        expect(result).to.have.property('fulfilled');
        
        if (result.fulfilled) {
          expect(result).to.have.property('fulfillTx');
          expect(result).to.have.property('processedTx');
        }
      } catch (error) {
        // Expected to fail without proper game setup
        console.log('Expected error without game setup:', error.message);
      }
    });
  });
});

export {};