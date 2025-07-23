import {
  Connection,
  PublicKey,
  // Transaction, // Removed unused import
  TransactionSignature,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js';
import {
  Program,
  AnchorProvider,
  web3,
  BN,
  IdlAccounts,
  IdlTypes,
} from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  // createAssociatedTokenAccountInstruction, // Removed unused import
  getAccount,
} from '@solana/spl-token';
import { IDL, TelegramLottery } from './idl/telegram_lottery';
import { OraoVRFService } from '../utils/orao-vrf';
import { networkStateAccountAddress, randomnessAccountAddress } from '@orao-network/solana-vrf';

// Types from the program
export type GameState = IdlAccounts<TelegramLottery>['gameState'];
export type PlayerList = IdlAccounts<TelegramLottery>['playerList'];
export type TreasuryState = IdlAccounts<TelegramLottery>['treasuryState'];
export type VrfResult = IdlAccounts<TelegramLottery>['vrfResult'];
export type GameStatus = IdlTypes<TelegramLottery>['GameStatus'];
export type Player = IdlTypes<TelegramLottery>['Player'];

// SDK Configuration
export interface LotterySDKConfig {
  connection: Connection;
  programId: PublicKey;
  wallet: Keypair;
  tokenMint: PublicKey;
  vrfOracle: PublicKey;
}

// Parameter types
export interface CreateGameParams {
  gameId: string;
  entryFee: number; // In MWOR tokens (not lamports)
  maxPlayers: number;
  winnerCount: number;
  paymentDeadlineMinutes: number;
}

export interface GameMonitor {
  gameId: string;
  unsubscribe: () => void;
}

// PDA Helper class
export class LotteryPDAHelper {
  constructor(private programId: PublicKey) {}

  getGamePDA(gameId: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('game'), Buffer.from(gameId)],
      this.programId
    );
  }

  getPlayerListPDA(gameId: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('players'), Buffer.from(gameId)],
      this.programId
    );
  }

  getEscrowPDA(gameId: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), Buffer.from(gameId)],
      this.programId
    );
  }

  getTreasuryPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('treasury')],
      this.programId
    );
  }

  getVrfPDA(gameId: string, round: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('vrf'),
        Buffer.from(gameId),
        Buffer.from([round])
      ],
      this.programId
    );
  }
}

// Main SDK Client
export class LotteryProgramClient {
  public program: Program<TelegramLottery>;
  public pdaHelper: LotteryPDAHelper;
  private provider: AnchorProvider;
  private oraoVrf: OraoVRFService;

  constructor(private config: LotterySDKConfig) {
    this.provider = new AnchorProvider(
      config.connection,
      {
        publicKey: config.wallet.publicKey,
        signTransaction: async (tx) => {
          if ('partialSign' in tx) {
            (tx as any).partialSign(config.wallet);
          }
          return tx;
        },
        signAllTransactions: async (txs) => {
          txs.forEach(tx => {
            if ('partialSign' in tx) {
              (tx as any).partialSign(config.wallet);
            }
          });
          return txs;
        },
      },
      { commitment: 'confirmed' }
    );

    this.program = new Program(IDL, config.programId, this.provider);
    this.pdaHelper = new LotteryPDAHelper(config.programId);
    
    // Initialize ORAO VRF service
    const cluster = config.connection.rpcEndpoint.includes('mainnet') ? 'mainnet-beta' : 'devnet';
    this.oraoVrf = new OraoVRFService(config.connection, config.programId, cluster as any);
  }

  /**
   * Initialize the lottery program (one-time setup)
   */
  async initialize(
    treasuryAuthority: PublicKey,
    feePercentage: number
  ): Promise<TransactionSignature> {
    const [treasuryPDA] = this.pdaHelper.getTreasuryPDA();
    
    // Create treasury token account
    const treasuryTokenAccount = await getAssociatedTokenAddress(
      this.config.tokenMint,
      treasuryPDA,
      true // allowOwnerOffCurve for PDA
    );

    const tx = await this.program.methods
      .initialize(treasuryAuthority, feePercentage)
      .accounts({
        authority: this.config.wallet.publicKey,
        treasuryState: treasuryPDA,
        treasuryTokenAccount,
        tokenMint: this.config.tokenMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return tx;
  }

  /**
   * Create a new lottery game
   */
  async createGame(params: CreateGameParams): Promise<GameState> {
    const [gamePDA] = this.pdaHelper.getGamePDA(params.gameId);
    const [playerListPDA] = this.pdaHelper.getPlayerListPDA(params.gameId);
    const [escrowPDA] = this.pdaHelper.getEscrowPDA(params.gameId);
    const [treasuryPDA] = this.pdaHelper.getTreasuryPDA();

    // Convert MWOR to smallest unit (assuming 6 decimals)
    const entryFeeLamports = new BN(params.entryFee * 1e6);

    const tx = await this.program.methods
      .createGame(
        params.gameId,
        entryFeeLamports,
        params.maxPlayers,
        params.winnerCount,
        params.paymentDeadlineMinutes
      )
      .accounts({
        authority: this.config.wallet.publicKey,
        gameState: gamePDA,
        playerList: playerListPDA,
        treasuryState: treasuryPDA,
        tokenMint: this.config.tokenMint,
        escrowAccount: escrowPDA,
        vrfOracle: this.config.vrfOracle || PublicKey.default,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();

    // Fetch and return the created game state
    const gameState = await this.program.account.gameState.fetch(gamePDA);
    return gameState;
  }

  /**
   * Join a game (called by player)
   */
  async joinGame(
    gameId: string,
    telegramId: string,
    playerWallet: PublicKey,
    playerKeypair?: Keypair
  ): Promise<TransactionSignature> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    const [playerListPDA] = this.pdaHelper.getPlayerListPDA(gameId);
    const [escrowPDA] = this.pdaHelper.getEscrowPDA(gameId);

    // Get player's token account
    const playerTokenAccount = await getAssociatedTokenAddress(
      this.config.tokenMint,
      playerWallet
    );

    // Check if token account exists
    try {
      await getAccount(this.config.connection, playerTokenAccount);
    } catch {
      throw new Error('Player token account not found. Please ensure wallet has MWOR tokens.');
    }

    const builder = this.program.methods
      .joinGame(gameId, telegramId)
      .accounts({
        player: playerWallet,
        gameState: gamePDA,
        playerList: playerListPDA,
        playerTokenAccount,
        escrowAccount: escrowPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
      });

    // If player keypair provided, sign with it
    if (playerKeypair) {
      return await builder.signers([playerKeypair]).rpc();
    } else {
      // Otherwise, return transaction for external signing
      const tx = await builder.transaction();
      return await this.provider.sendAndConfirm(tx);
    }
  }

  /**
   * Select a number for the game
   */
  async selectNumber(
    gameId: string,
    number: number,
    playerWallet: PublicKey,
    playerKeypair?: Keypair
  ): Promise<TransactionSignature> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    const [playerListPDA] = this.pdaHelper.getPlayerListPDA(gameId);

    const builder = this.program.methods
      .selectNumber(gameId, number)
      .accounts({
        player: playerWallet,
        gameState: gamePDA,
        playerList: playerListPDA,
        clock: SYSVAR_CLOCK_PUBKEY,
      });

    if (playerKeypair) {
      return await builder.signers([playerKeypair]).rpc();
    } else {
      const tx = await builder.transaction();
      return await this.provider.sendAndConfirm(tx);
    }
  }

  /**
   * Complete the game and start prize distribution
   */
  async completeGame(gameId: string): Promise<TransactionSignature> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    const [playerListPDA] = this.pdaHelper.getPlayerListPDA(gameId);
    const [escrowPDA] = this.pdaHelper.getEscrowPDA(gameId);
    const [treasuryPDA] = this.pdaHelper.getTreasuryPDA();

    const treasuryState = await this.program.account.treasuryState.fetch(treasuryPDA);

    const tx = await this.program.methods
      .completeGame(gameId)
      .accounts({
        authority: this.config.wallet.publicKey,
        gameState: gamePDA,
        playerList: playerListPDA,
        treasuryState: treasuryPDA,
        escrowAccount: escrowPDA,
        treasuryTokenAccount: treasuryState.treasuryTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();

    return tx;
  }

  /**
   * Claim prize as a winner
   */
  async claimPrize(
    gameId: string,
    winnerWallet: PublicKey,
    winnerKeypair?: Keypair
  ): Promise<TransactionSignature> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    const [playerListPDA] = this.pdaHelper.getPlayerListPDA(gameId);
    const [escrowPDA] = this.pdaHelper.getEscrowPDA(gameId);

    const winnerTokenAccount = await getAssociatedTokenAddress(
      this.config.tokenMint,
      winnerWallet
    );

    const builder = this.program.methods
      .claimPrize(gameId)
      .accounts({
        winner: winnerWallet,
        gameState: gamePDA,
        playerList: playerListPDA,
        escrowAccount: escrowPDA,
        winnerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
      });

    if (winnerKeypair) {
      return await builder.signers([winnerKeypair]).rpc();
    } else {
      const tx = await builder.transaction();
      return await this.provider.sendAndConfirm(tx);
    }
  }

  /**
   * Get game state
   */
  async getGame(gameId: string): Promise<GameState | null> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    
    try {
      const gameState = await this.program.account.gameState.fetch(gamePDA);
      return gameState;
    } catch {
      return null;
    }
  }

  /**
   * Get player list for a game
   */
  async getPlayerList(gameId: string): Promise<Player[]> {
    const [playerListPDA] = this.pdaHelper.getPlayerListPDA(gameId);
    
    try {
      const playerList = await this.program.account.playerList.fetch(playerListPDA);
      return playerList.players as Player[];
    } catch {
      return [];
    }
  }

  /**
   * Get all games for a player
   */
  async getPlayerGames(_playerWallet: PublicKey): Promise<GameState[]> {
    // This would need to be implemented with proper indexing
    // For now, return empty array
    return [];
  }

  /**
   * Subscribe to game events
   */
  onGameCreated(callback: (game: GameState) => void): number {
    return this.program.addEventListener('GameCreatedEvent', (event) => {
      this.getGame(event.gameId).then(game => {
        if (game) callback(game);
      });
    });
  }

  onPlayerJoined(gameId: string, callback: (player: Player) => void): number {
    return this.program.addEventListener('PlayerJoinedEvent', (event) => {
      if (event.gameId === gameId) {
        this.getPlayerList(gameId).then(players => {
          const player = players.find(p => p.wallet.toString() === event.player.toString());
          if (player) callback(player);
        });
      }
    });
  }

  onGameCompleted(gameId: string, callback: (winners: Player[]) => void): number {
    return this.program.addEventListener('GameCompletedEvent', (event) => {
      if (event.gameId === gameId) {
        this.getPlayerList(gameId).then(players => {
          const winners = players.filter(p => p.isWinner);
          callback(winners);
        });
      }
    });
  }

  /**
   * Unsubscribe from events
   */
  removeEventListener(listenerId: number): void {
    this.program.removeEventListener(listenerId);
  }

  /**
   * Monitor a game for all state changes
   */
  async monitorGame(gameId: string): Promise<GameMonitor> {
    const listeners: number[] = [];

    // Subscribe to all relevant events
    const joinListener = this.onPlayerJoined(gameId, (player) => {
      console.log(`Player joined game ${gameId}:`, player.telegramId);
    });
    listeners.push(joinListener);

    const completeListener = this.onGameCompleted(gameId, (winners) => {
      console.log(`Game ${gameId} completed with ${winners.length} winners`);
    });
    listeners.push(completeListener);

    return {
      gameId,
      unsubscribe: () => {
        listeners.forEach(id => this.removeEventListener(id));
      }
    };
  }

  /**
   * Request randomness from ORAO VRF
   */
  async requestOraoVrf(
    gameId: string,
    round: number,
    playerWallet: PublicKey,
    playerKeypair?: Keypair
  ): Promise<TransactionSignature> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    const networkState = networkStateAccountAddress();
    const treasury = await this.oraoVrf.getTreasuryAccount();
    const randomnessAccount = randomnessAccountAddress(gamePDA.toBuffer());

    const builder = this.program.methods
      .requestOraoVrf(gameId, round)
      .accounts({
        player: playerWallet,
        gameState: gamePDA,
        networkState,
        treasury,
        randomness: randomnessAccount,
        oraoVrf: this.oraoVrf.getVrfProgramId(),
        systemProgram: SystemProgram.programId,
        recentSlothashes: web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      });

    if (playerKeypair) {
      return await builder.signers([playerKeypair]).rpc();
    } else {
      const tx = await builder.transaction();
      return await this.provider.sendAndConfirm(tx);
    }
  }

  /**
   * Fulfill ORAO VRF request
   */
  async fulfillOraoVrf(
    gameId: string,
    round: number
  ): Promise<TransactionSignature> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    const [vrfPDA] = this.pdaHelper.getVrfPDA(gameId, round);
    const randomnessAccount = randomnessAccountAddress(gamePDA.toBuffer());

    return await this.program.methods
      .fulfillOraoVrf(gameId, round)
      .accounts({
        authority: this.config.wallet.publicKey,
        gameState: gamePDA,
        randomness: randomnessAccount,
        vrfResult: vrfPDA,
        oraoVrfProgram: this.oraoVrf.getVrfProgramId(),
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();
  }

  /**
   * Check if VRF request is fulfilled
   */
  async isVrfFulfilled(gameId: string): Promise<boolean> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    return await this.oraoVrf.isRandomnessFulfilled(gamePDA);
  }

  /**
   * Wait for VRF fulfillment
   */
  async waitForVrfFulfillment(
    gameId: string,
    maxWaitTime: number = 30000
  ): Promise<boolean> {
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    return await this.oraoVrf.waitForFulfillment(gamePDA, maxWaitTime);
  }

  /**
   * Get estimated VRF costs for a game
   */
  async getVrfCostEstimate(expectedRounds: number): Promise<{
    perRoundCost: number;
    totalCost: number;
    perRoundCostSOL: number;
    totalCostSOL: number;
  }> {
    return await this.oraoVrf.estimateGameVrfCost(expectedRounds);
  }

  /**
   * Process elimination with ORAO VRF
   */
  async processEliminationWithOrao(
    gameId: string,
    round: number
  ): Promise<{
    requestTx: TransactionSignature;
    fulfilled: boolean;
    fulfillTx?: TransactionSignature;
    processedTx?: TransactionSignature;
  }> {
    // Step 1: Request VRF
    const requestTx = await this.requestOraoVrf(
      gameId,
      round,
      this.config.wallet.publicKey,
      this.config.wallet
    );

    // Step 2: Wait for fulfillment
    const fulfilled = await this.waitForVrfFulfillment(gameId);
    if (!fulfilled) {
      return { requestTx, fulfilled: false };
    }

    // Step 3: Fulfill the VRF
    const fulfillTx = await this.fulfillOraoVrf(gameId, round);

    // Step 4: Process elimination
    const [gamePDA] = this.pdaHelper.getGamePDA(gameId);
    const [playerListPDA] = this.pdaHelper.getPlayerListPDA(gameId);
    const [vrfPDA] = this.pdaHelper.getVrfPDA(gameId, round);

    const processedTx = await this.program.methods
      .processElimination(gameId, round)
      .accounts({
        authority: this.config.wallet.publicKey,
        gameState: gamePDA,
        playerList: playerListPDA,
        vrfResult: vrfPDA,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();

    return {
      requestTx,
      fulfilled: true,
      fulfillTx,
      processedTx,
    };
  }
}

// Export a factory function for easy initialization
export async function createLotteryClient(
  connection: Connection,
  programId: string,
  botWallet: Keypair,
  tokenMint: string,
  vrfOracle: string
): Promise<LotteryProgramClient> {
  const config: LotterySDKConfig = {
    connection,
    programId: new PublicKey(programId),
    wallet: botWallet,
    tokenMint: new PublicKey(tokenMint),
    vrfOracle: new PublicKey(vrfOracle),
  };

  return new LotteryProgramClient(config);
}