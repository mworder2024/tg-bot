import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { LotteryProgramClient, createLotteryClient, GameState, Player } from '../../blockchain/lottery-sdk';
// import { BN } from '@coral-xyz/anchor'; // Removed unused import
import { logger } from '../../utils/logger';
import config from '../../config';

export interface SolanaGameConfig {
  gameId: string;
  entryFee: number; // In MWOR tokens
  maxPlayers: number;
  winnerCount: number;
  paymentDeadlineMinutes: number;
}

export class SolanaIntegrationService {
  private client!: LotteryProgramClient;
  private connection: Connection;
  private botWallet: Keypair;
  private programId: PublicKey;
  private tokenMint: PublicKey;
  private vrfOracle: PublicKey;

  constructor() {
    this.connection = new Connection(
      config.solana.rpcUrl,
      {
        commitment: 'confirmed',
        wsEndpoint: config.solana.wsUrl
      }
    );

    // Load bot wallet
    this.botWallet = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(config.solana.botWalletKey))
    );

    this.programId = new PublicKey(config.solana.programId);
    this.tokenMint = new PublicKey(config.solana.tokenMint);
    this.vrfOracle = new PublicKey(config.solana.vrfOracle);
  }

  async initialize(): Promise<void> {
    try {
      this.client = await createLotteryClient(
        this.connection,
        config.solana.programId,
        this.botWallet,
        config.solana.tokenMint,
        config.solana.vrfOracle
      );

      logger.info('Solana integration initialized', {
        programId: this.programId.toBase58(),
        botWallet: this.botWallet.publicKey.toBase58(),
        network: config.solana.network
      });
    } catch (error) {
      logger.error('Failed to initialize Solana integration', error);
      throw error;
    }
  }

  /**
   * Create a new lottery game on-chain
   */
  async createGame(config: SolanaGameConfig): Promise<GameState> {
    try {
      logger.info('Creating on-chain game', config);

      const gameState = await this.client.createGame({
        gameId: config.gameId,
        entryFee: config.entryFee,
        maxPlayers: config.maxPlayers,
        winnerCount: config.winnerCount,
        paymentDeadlineMinutes: config.paymentDeadlineMinutes,
      });

      logger.info('Game created on-chain', {
        gameId: config.gameId,
        gamePDA: this.client.pdaHelper.getGamePDA(config.gameId)[0].toBase58(),
      });

      return gameState;
    } catch (error) {
      logger.error('Failed to create game on-chain', { error, config });
      throw error;
    }
  }

  /**
   * Generate payment instruction for player
   */
  async generatePaymentInstruction(
    gameId: string,
    telegramId: string,
    playerWallet: PublicKey
  ): Promise<{
    transaction: Transaction;
    escrowAccount: PublicKey;
    amount: number;
  }> {
    try {
      const game = await this.client.getGame(gameId);
      if (!game) {
        throw new Error('Game not found');
      }

      // Get PDAs
      const [gamePDA] = this.client.pdaHelper.getGamePDA(gameId);
      const [playerListPDA] = this.client.pdaHelper.getPlayerListPDA(gameId);
      const [escrowPDA] = this.client.pdaHelper.getEscrowPDA(gameId);

      // Check if player needs token account
      const playerTokenAccount = await getAssociatedTokenAddress(
        this.tokenMint,
        playerWallet
      );

      const transaction = new Transaction();

      // Add instruction to create token account if needed
      try {
        await this.connection.getAccountInfo(playerTokenAccount);
      } catch {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            playerWallet,
            playerTokenAccount,
            playerWallet,
            this.tokenMint
          )
        );
      }

      // Build join game instruction
      const joinInstruction = await this.client.program.methods
        .joinGame(gameId, telegramId)
        .accounts({
          player: playerWallet,
          gameState: gamePDA,
          playerList: playerListPDA,
          playerTokenAccount,
          escrowAccount: escrowPDA,
        })
        .instruction();

      transaction.add(joinInstruction);

      return {
        transaction,
        escrowAccount: escrowPDA,
        amount: game.entryFee.toNumber(),
      };
    } catch (error) {
      logger.error('Failed to generate payment instruction', { error, gameId, telegramId });
      throw error;
    }
  }

  /**
   * Verify player has joined the game
   */
  async verifyPlayerJoined(gameId: string, playerWallet: PublicKey): Promise<boolean> {
    try {
      const players = await this.client.getPlayerList(gameId);
      return players.some(p => p.wallet.equals(playerWallet));
    } catch (error) {
      logger.error('Failed to verify player joined', { error, gameId });
      return false;
    }
  }

  /**
   * Submit player's number selection
   */
  async selectNumber(
    gameId: string,
    playerWallet: PublicKey,
    number: number
  ): Promise<string> {
    try {
      // This would typically be done by the player's wallet
      // For testing, we can use a service wallet
      const tx = await this.client.selectNumber(
        gameId,
        number,
        playerWallet
      );

      logger.info('Number selected on-chain', {
        gameId,
        player: playerWallet.toBase58(),
        number,
        tx
      });

      return tx;
    } catch (error) {
      logger.error('Failed to select number', { error, gameId, number });
      throw error;
    }
  }

  /**
   * Submit VRF result (oracle only)
   */
  async submitVRF(
    gameId: string,
    round: number,
    randomValue: Uint8Array
  ): Promise<string> {
    try {
      const proof = new Uint8Array(64); // Simplified for testing
      
      const tx = await this.client.program.methods
        .submitVrf(gameId, round, Array.from(randomValue), Array.from(proof))
        .accounts({
          vrfOracle: this.vrfOracle,
          gameState: this.client.pdaHelper.getGamePDA(gameId)[0],
          vrfResult: this.client.pdaHelper.getVrfPDA(gameId, round)[0],
        })
        .signers([this.botWallet]) // Assuming bot acts as oracle for testing
        .rpc();

      logger.info('VRF submitted', { gameId, round, tx });
      return tx;
    } catch (error) {
      logger.error('Failed to submit VRF', { error, gameId, round });
      throw error;
    }
  }

  /**
   * Process elimination round
   */
  async processElimination(gameId: string, round: number): Promise<string> {
    try {
      const tx = await this.client.program.methods
        .processElimination(gameId, round)
        .accounts({
          authority: this.botWallet.publicKey,
          gameState: this.client.pdaHelper.getGamePDA(gameId)[0],
          playerList: this.client.pdaHelper.getPlayerListPDA(gameId)[0],
          vrfResult: this.client.pdaHelper.getVrfPDA(gameId, round)[0],
        })
        .signers([this.botWallet])
        .rpc();

      logger.info('Elimination processed', { gameId, round, tx });
      return tx;
    } catch (error) {
      logger.error('Failed to process elimination', { error, gameId, round });
      throw error;
    }
  }

  /**
   * Complete the game
   */
  async completeGame(gameId: string): Promise<string> {
    try {
      const tx = await this.client.completeGame(gameId);
      logger.info('Game completed on-chain', { gameId, tx });
      return tx;
    } catch (error) {
      logger.error('Failed to complete game', { error, gameId });
      throw error;
    }
  }

  /**
   * Get game state
   */
  async getGameState(gameId: string): Promise<GameState | null> {
    try {
      return await this.client.getGame(gameId);
    } catch (error) {
      logger.error('Failed to get game state', { error, gameId });
      return null;
    }
  }

  /**
   * Get player list
   */
  async getPlayerList(gameId: string): Promise<Player[]> {
    try {
      return await this.client.getPlayerList(gameId);
    } catch (error) {
      logger.error('Failed to get player list', { error, gameId });
      return [];
    }
  }

  /**
   * Monitor game events
   */
  async monitorGame(gameId: string): Promise<void> {
    const monitor = await this.client.monitorGame(gameId);
    
    // Store monitor for cleanup
    this.gameMonitors.set(gameId, monitor);
  }

  /**
   * Stop monitoring game
   */
  stopMonitoring(gameId: string): void {
    const monitor = this.gameMonitors.get(gameId);
    if (monitor) {
      monitor.unsubscribe();
      this.gameMonitors.delete(gameId);
    }
  }

  private gameMonitors = new Map<string, { unsubscribe: () => void }>();
}

// Singleton instance
export const solanaIntegration = new SolanaIntegrationService();