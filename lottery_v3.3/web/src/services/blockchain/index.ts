/**
 * Unified Blockchain Service Layer for PWA
 * Provides integration with Solana programs across multiple platforms
 */

import { Connection, PublicKey, Keypair, Transaction, TransactionSignature } from '@solana/web3.js';
import { 
  WalletAdapter,
  WalletAdapterNetwork,
  BaseSignerWalletAdapter 
} from '@solana/wallet-adapter-base';
import { 
  createLotteryClient, 
  LotteryProgramClient,
  CreateGameParams,
  GameState,
  Player
} from '../../../../src/blockchain/lottery-sdk';
import { SolanaService } from '../../../../src/blockchain/solana-service';
import { BlockchainConfig } from '../../../../src/types/blockchain';

// Platform types
export type Platform = 'web' | 'telegram' | 'discord' | 'mobile';

// Transaction types
export interface TransactionRequest {
  platform: Platform;
  type: 'join_game' | 'claim_prize' | 'create_game' | 'select_number';
  gameId?: string;
  params?: any;
  userId: string;
  walletAddress?: string;
}

export interface TransactionStatus {
  signature: string;
  status: 'pending' | 'processing' | 'confirmed' | 'failed';
  error?: string;
  confirmations?: number;
  slot?: number;
}

export interface WalletState {
  connected: boolean;
  publicKey: string | null;
  balance: {
    sol: number;
    mwor: number;
  };
  adapter?: WalletAdapter;
}

// Event types for real-time updates
export type BlockchainEvent = 
  | { type: 'game_created'; data: GameState }
  | { type: 'player_joined'; data: { gameId: string; player: Player } }
  | { type: 'game_completed'; data: { gameId: string; winners: Player[] } }
  | { type: 'transaction_update'; data: TransactionStatus }
  | { type: 'wallet_update'; data: WalletState };

// Blockchain service configuration
export interface BlockchainServiceConfig {
  rpcUrl: string;
  programId: string;
  tokenMint: string;
  vfrOracle: string;
  websocketUrl?: string;
  network: WalletAdapterNetwork;
}

/**
 * Main blockchain service class
 * Handles all blockchain interactions for the PWA
 */
export class BlockchainService {
  private connection: Connection;
  private lotteryClient: LotteryProgramClient | null = null;
  private solanaService: SolanaService | null = null;
  private config: BlockchainServiceConfig;
  private eventListeners: Map<string, ((event: BlockchainEvent) => void)[]> = new Map();
  private transactionCache: Map<string, TransactionStatus> = new Map();
  private ws: WebSocket | null = null;

  constructor(config: BlockchainServiceConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: config.websocketUrl
    });
  }

  /**
   * Initialize the blockchain service
   */
  async initialize(platform: Platform): Promise<void> {
    console.log(`Initializing blockchain service for ${platform}`);

    // Initialize Solana service for basic operations
    const blockchainConfig: BlockchainConfig = {
      rpcUrl: this.config.rpcUrl,
      mworTokenMint: this.config.tokenMint,
      encryptionKey: '', // Not used in PWA
      botWalletPrivateKey: '', // Platform-specific handling
      treasuryWalletPrivateKey: '',
      systemFeePercentage: 5,
      paymentTimeoutMinutes: 5
    };

    this.solanaService = new SolanaService(
      blockchainConfig,
      console as any // Simple logger for PWA
    );

    // Initialize WebSocket for real-time updates
    if (this.config.websocketUrl) {
      this.connectWebSocket();
    }
  }

  /**
   * Connect to WebSocket for real-time blockchain events
   */
  private connectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
    }

    this.ws = new WebSocket(this.config.websocketUrl!);

    this.ws.onopen = () => {
      console.log('Connected to blockchain WebSocket');
      this.emit({ type: 'wallet_update', data: { connected: true } as WalletState });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleWebSocketMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting in 5s...');
      setTimeout(() => this.connectWebSocket(), 5000);
    };
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(data: any): void {
    switch (data.type) {
      case 'game_created':
      case 'player_joined':
      case 'game_completed':
        this.emit({ type: data.type, data: data.payload });
        break;
      case 'transaction_update':
        const txStatus = this.transactionCache.get(data.signature);
        if (txStatus) {
          txStatus.status = data.status;
          txStatus.confirmations = data.confirmations;
          txStatus.error = data.error;
          this.emit({ type: 'transaction_update', data: txStatus });
        }
        break;
    }
  }

  /**
   * Create lottery client for platform-specific wallet
   */
  async createLotteryClientForPlatform(
    platform: Platform,
    wallet?: BaseSignerWalletAdapter | Keypair
  ): Promise<LotteryProgramClient> {
    let botWallet: Keypair;

    switch (platform) {
      case 'telegram':
        // For Telegram, use server-side wallet (would be provided by backend)
        if (!wallet || !(wallet instanceof Keypair)) {
          throw new Error('Telegram platform requires server-side Keypair');
        }
        botWallet = wallet;
        break;

      case 'web':
      case 'discord':
      case 'mobile':
        // For web/discord/mobile, create a temporary keypair
        // Real signing will be done by wallet adapter
        botWallet = Keypair.generate();
        break;

      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    this.lotteryClient = await createLotteryClient(
      this.connection,
      this.config.programId,
      botWallet,
      this.config.tokenMint,
      this.config.vfrOracle
    );

    return this.lotteryClient;
  }

  /**
   * Execute a transaction based on platform
   */
  async executeTransaction(
    request: TransactionRequest,
    walletAdapter?: BaseSignerWalletAdapter
  ): Promise<TransactionStatus> {
    const txId = `tx_${Date.now()}_${request.userId}`;
    const status: TransactionStatus = {
      signature: '',
      status: 'pending'
    };

    this.transactionCache.set(txId, status);

    try {
      // Ensure lottery client is initialized
      if (!this.lotteryClient) {
        await this.createLotteryClientForPlatform(request.platform, walletAdapter as any);
      }

      let signature: TransactionSignature = '';

      switch (request.type) {
        case 'join_game':
          signature = await this.handleJoinGame(request, walletAdapter);
          break;
        case 'select_number':
          signature = await this.handleSelectNumber(request, walletAdapter);
          break;
        case 'claim_prize':
          signature = await this.handleClaimPrize(request, walletAdapter);
          break;
        case 'create_game':
          if (request.platform !== 'web') {
            throw new Error('Game creation only allowed from web platform');
          }
          const game = await this.handleCreateGame(request);
          signature = 'game_created'; // Special case for game creation
          break;
      }

      status.signature = signature;
      status.status = 'processing';
      this.emit({ type: 'transaction_update', data: status });

      // Monitor transaction confirmation
      if (signature !== 'game_created') {
        this.monitorTransaction(signature, status);
      } else {
        status.status = 'confirmed';
        this.emit({ type: 'transaction_update', data: status });
      }

      return status;
    } catch (error) {
      status.status = 'failed';
      status.error = error instanceof Error ? error.message : 'Unknown error';
      this.emit({ type: 'transaction_update', data: status });
      throw error;
    }
  }

  /**
   * Handle join game transaction
   */
  private async handleJoinGame(
    request: TransactionRequest,
    walletAdapter?: BaseSignerWalletAdapter
  ): Promise<TransactionSignature> {
    if (!request.gameId || !request.walletAddress) {
      throw new Error('Game ID and wallet address required');
    }

    const playerWallet = new PublicKey(request.walletAddress);

    if (request.platform === 'telegram') {
      // Server-side signing for Telegram
      return await this.lotteryClient!.joinGame(
        request.gameId,
        request.params.telegramId,
        playerWallet
      );
    } else {
      // Client-side signing for other platforms
      if (!walletAdapter) {
        throw new Error('Wallet adapter required for client-side signing');
      }

      // Build transaction without signing
      const tx = await this.buildJoinGameTransaction(
        request.gameId,
        request.params.telegramId || request.userId,
        playerWallet
      );

      // Sign with wallet adapter
      const signedTx = await walletAdapter.signTransaction!(tx);
      
      // Send transaction
      const signature = await this.connection.sendRawTransaction(signedTx.serialize());
      return signature;
    }
  }

  /**
   * Build join game transaction (for client-side signing)
   */
  private async buildJoinGameTransaction(
    gameId: string,
    telegramId: string,
    playerWallet: PublicKey
  ): Promise<Transaction> {
    // This would use the lottery SDK to build the transaction
    // without signing it
    throw new Error('Not implemented - would build transaction here');
  }

  /**
   * Handle select number transaction
   */
  private async handleSelectNumber(
    request: TransactionRequest,
    walletAdapter?: BaseSignerWalletAdapter
  ): Promise<TransactionSignature> {
    if (!request.gameId || !request.walletAddress || !request.params?.number) {
      throw new Error('Game ID, wallet address, and number required');
    }

    const playerWallet = new PublicKey(request.walletAddress);

    return await this.lotteryClient!.selectNumber(
      request.gameId,
      request.params.number,
      playerWallet
    );
  }

  /**
   * Handle claim prize transaction
   */
  private async handleClaimPrize(
    request: TransactionRequest,
    walletAdapter?: BaseSignerWalletAdapter
  ): Promise<TransactionSignature> {
    if (!request.gameId || !request.walletAddress) {
      throw new Error('Game ID and wallet address required');
    }

    const winnerWallet = new PublicKey(request.walletAddress);

    return await this.lotteryClient!.claimPrize(
      request.gameId,
      winnerWallet
    );
  }

  /**
   * Handle create game (admin only)
   */
  private async handleCreateGame(request: TransactionRequest): Promise<GameState> {
    const params: CreateGameParams = request.params;
    
    if (!params) {
      throw new Error('Game parameters required');
    }

    return await this.lotteryClient!.createGame(params);
  }

  /**
   * Monitor transaction confirmation
   */
  private async monitorTransaction(
    signature: TransactionSignature,
    status: TransactionStatus
  ): Promise<void> {
    let attempts = 0;
    const maxAttempts = 30;

    const checkStatus = async () => {
      try {
        const result = await this.connection.getSignatureStatus(signature);
        
        if (result.value) {
          status.confirmations = result.value.confirmations || 0;
          status.slot = result.value.slot;

          if (result.value.err) {
            status.status = 'failed';
            status.error = JSON.stringify(result.value.err);
            this.emit({ type: 'transaction_update', data: status });
            return;
          }

          if (result.value.confirmationStatus === 'confirmed' ||
              result.value.confirmationStatus === 'finalized') {
            status.status = 'confirmed';
            this.emit({ type: 'transaction_update', data: status });
            return;
          }
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(checkStatus, 2000);
        } else {
          status.status = 'failed';
          status.error = 'Transaction confirmation timeout';
          this.emit({ type: 'transaction_update', data: status });
        }
      } catch (error) {
        console.error('Error checking transaction status:', error);
        status.status = 'failed';
        status.error = 'Failed to check transaction status';
        this.emit({ type: 'transaction_update', data: status });
      }
    };

    checkStatus();
  }

  /**
   * Get game state
   */
  async getGame(gameId: string): Promise<GameState | null> {
    if (!this.lotteryClient) {
      await this.createLotteryClientForPlatform('web');
    }
    return await this.lotteryClient!.getGame(gameId);
  }

  /**
   * Get player list for a game
   */
  async getPlayerList(gameId: string): Promise<Player[]> {
    if (!this.lotteryClient) {
      await this.createLotteryClientForPlatform('web');
    }
    return await this.lotteryClient!.getPlayerList(gameId);
  }

  /**
   * Check wallet balance
   */
  async getWalletBalance(address: string): Promise<{ sol: number; mwor: number }> {
    if (!this.solanaService) {
      throw new Error('Solana service not initialized');
    }

    const balance = await this.solanaService.getWalletBalance(address);
    return {
      sol: balance.solBalance / 1e9, // Convert lamports to SOL
      mwor: balance.mworBalance / 1e6 // Convert to MWOR (assuming 6 decimals)
    };
  }

  /**
   * Subscribe to blockchain events
   */
  on(event: BlockchainEvent['type'], callback: (data: any) => void): () => void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(callback);
    this.eventListeners.set(event, listeners);

    // Return unsubscribe function
    return () => {
      const updatedListeners = this.eventListeners.get(event) || [];
      const index = updatedListeners.indexOf(callback);
      if (index > -1) {
        updatedListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit blockchain event
   */
  private emit(event: BlockchainEvent): void {
    const listeners = this.eventListeners.get(event.type) || [];
    listeners.forEach(callback => callback(event.data));
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.ws) {
      this.ws.close();
    }
    this.eventListeners.clear();
    this.transactionCache.clear();
  }
}

// Export singleton instance
let blockchainService: BlockchainService | null = null;

export function getBlockchainService(config?: BlockchainServiceConfig): BlockchainService {
  if (!blockchainService && config) {
    blockchainService = new BlockchainService(config);
  }
  if (!blockchainService) {
    throw new Error('Blockchain service not initialized');
  }
  return blockchainService;
}