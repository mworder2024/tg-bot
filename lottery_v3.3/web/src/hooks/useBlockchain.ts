/**
 * React hook for blockchain interactions
 * Provides unified interface across all platforms
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { 
  BlockchainService, 
  BlockchainEvent,
  TransactionRequest,
  TransactionStatus,
  WalletState,
  Platform,
  getBlockchainService
} from '../services/blockchain';
import { 
  createPlatformAdapter,
  TelegramWalletAdapter,
  DiscordWalletAdapter,
  MobileDeepLinkAdapter
} from '../services/blockchain/platform-adapters';
import { GameState, Player } from '../../../src/blockchain/lottery-sdk';

// Hook configuration
interface UseBlockchainConfig {
  platform: Platform;
  userId?: string;
  autoConnect?: boolean;
  onError?: (error: Error) => void;
}

// Hook return type
interface UseBlockchainReturn {
  // Connection state
  connected: boolean;
  connecting: boolean;
  publicKey: PublicKey | null;
  balance: { sol: number; mwor: number };
  
  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  
  // Game operations
  joinGame: (gameId: string, telegramId?: string) => Promise<TransactionStatus>;
  selectNumber: (gameId: string, number: number) => Promise<TransactionStatus>;
  claimPrize: (gameId: string) => Promise<TransactionStatus>;
  createGame: (params: any) => Promise<TransactionStatus>;
  
  // Game queries
  getGame: (gameId: string) => Promise<GameState | null>;
  getPlayerList: (gameId: string) => Promise<Player[]>;
  
  // Transaction tracking
  transactions: Map<string, TransactionStatus>;
  pendingTransactions: TransactionStatus[];
  
  // Refresh functions
  refreshBalance: () => Promise<void>;
  refreshGame: (gameId: string) => Promise<void>;
}

/**
 * Main blockchain hook
 */
export function useBlockchain(config: UseBlockchainConfig): UseBlockchainReturn {
  const webWallet = useWallet(); // For web platform
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [balance, setBalance] = useState({ sol: 0, mwor: 0 });
  const [transactions, setTransactions] = useState<Map<string, TransactionStatus>>(new Map());
  
  const blockchainService = useRef<BlockchainService | null>(null);
  const platformAdapter = useRef<any>(null);
  const unsubscribers = useRef<(() => void)[]>([]);

  // Initialize blockchain service
  useEffect(() => {
    const initService = async () => {
      try {
        // Get service configuration from environment
        const serviceConfig = {
          rpcUrl: process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
          programId: process.env.REACT_APP_PROGRAM_ID || '',
          tokenMint: process.env.REACT_APP_TOKEN_MINT || '',
          vfrOracle: process.env.REACT_APP_VFR_ORACLE || '',
          websocketUrl: process.env.REACT_APP_BLOCKCHAIN_WS_URL,
          network: 'mainnet-beta' as any
        };

        blockchainService.current = getBlockchainService(serviceConfig);
        await blockchainService.current.initialize(config.platform);

        // Subscribe to blockchain events
        const unsubWallet = blockchainService.current.on('wallet_update', handleWalletUpdate);
        const unsubTx = blockchainService.current.on('transaction_update', handleTransactionUpdate);
        const unsubGame = blockchainService.current.on('game_created', handleGameEvent);
        const unsubPlayer = blockchainService.current.on('player_joined', handleGameEvent);
        const unsubComplete = blockchainService.current.on('game_completed', handleGameEvent);

        unsubscribers.current = [unsubWallet, unsubTx, unsubGame, unsubPlayer, unsubComplete];

        // Auto-connect if configured
        if (config.autoConnect) {
          await connect();
        }
      } catch (error) {
        console.error('Failed to initialize blockchain service:', error);
        config.onError?.(error as Error);
      }
    };

    initService();

    // Cleanup
    return () => {
      unsubscribers.current.forEach(unsub => unsub());
      blockchainService.current?.dispose();
    };
  }, [config.platform]);

  // Platform-specific connection
  const connect = useCallback(async () => {
    if (connecting || connected) return;

    setConnecting(true);
    try {
      switch (config.platform) {
        case 'web':
          // Use standard Solana wallet adapter
          if (!webWallet.connected) {
            await webWallet.connect();
          }
          setPublicKey(webWallet.publicKey);
          break;

        case 'telegram':
          // Create Telegram adapter
          platformAdapter.current = createPlatformAdapter('telegram', {
            serverEndpoint: process.env.REACT_APP_API_URL || '',
            userId: config.userId
          });
          await platformAdapter.current.connect();
          setPublicKey(platformAdapter.current.publicKey);
          break;

        case 'discord':
          // Create Discord adapter
          platformAdapter.current = createPlatformAdapter('discord', {
            botEndpoint: process.env.REACT_APP_DISCORD_BOT_URL || '',
            discordUserId: config.userId
          });
          await platformAdapter.current.connect();
          setPublicKey(platformAdapter.current.publicKey);
          break;

        case 'mobile':
          // Create mobile adapter
          platformAdapter.current = createPlatformAdapter('mobile', {
            walletScheme: 'solana-wallet',
            returnUrl: window.location.origin + '/wallet-return'
          });
          await platformAdapter.current.connect();
          setPublicKey(platformAdapter.current.publicKey);
          break;
      }

      setConnected(true);
      
      // Load initial balance
      if (publicKey) {
        await refreshBalance();
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      config.onError?.(error as Error);
    } finally {
      setConnecting(false);
    }
  }, [config.platform, config.userId, webWallet, connected, connecting, publicKey]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    if (config.platform === 'web') {
      webWallet.disconnect();
    } else if (platformAdapter.current) {
      platformAdapter.current.disconnect();
    }
    
    setConnected(false);
    setPublicKey(null);
    setBalance({ sol: 0, mwor: 0 });
  }, [config.platform, webWallet]);

  // Refresh balance
  const refreshBalance = useCallback(async () => {
    if (!publicKey || !blockchainService.current) return;

    try {
      const newBalance = await blockchainService.current.getWalletBalance(publicKey.toString());
      setBalance(newBalance);
    } catch (error) {
      console.error('Failed to refresh balance:', error);
      config.onError?.(error as Error);
    }
  }, [publicKey, config.onError]);

  // Join game
  const joinGame = useCallback(async (gameId: string, telegramId?: string): Promise<TransactionStatus> => {
    if (!publicKey || !blockchainService.current) {
      throw new Error('Wallet not connected');
    }

    const request: TransactionRequest = {
      platform: config.platform,
      type: 'join_game',
      gameId,
      userId: config.userId || publicKey.toString(),
      walletAddress: publicKey.toString(),
      params: { telegramId: telegramId || config.userId }
    };

    const walletAdapter = config.platform === 'web' ? webWallet : platformAdapter.current;
    const status = await blockchainService.current.executeTransaction(request, walletAdapter);
    
    // Update local transaction cache
    setTransactions(prev => new Map(prev).set(status.signature, status));
    
    return status;
  }, [publicKey, config.platform, config.userId, webWallet]);

  // Select number
  const selectNumber = useCallback(async (gameId: string, number: number): Promise<TransactionStatus> => {
    if (!publicKey || !blockchainService.current) {
      throw new Error('Wallet not connected');
    }

    const request: TransactionRequest = {
      platform: config.platform,
      type: 'select_number',
      gameId,
      userId: config.userId || publicKey.toString(),
      walletAddress: publicKey.toString(),
      params: { number }
    };

    const walletAdapter = config.platform === 'web' ? webWallet : platformAdapter.current;
    const status = await blockchainService.current.executeTransaction(request, walletAdapter);
    
    setTransactions(prev => new Map(prev).set(status.signature, status));
    
    return status;
  }, [publicKey, config.platform, config.userId, webWallet]);

  // Claim prize
  const claimPrize = useCallback(async (gameId: string): Promise<TransactionStatus> => {
    if (!publicKey || !blockchainService.current) {
      throw new Error('Wallet not connected');
    }

    const request: TransactionRequest = {
      platform: config.platform,
      type: 'claim_prize',
      gameId,
      userId: config.userId || publicKey.toString(),
      walletAddress: publicKey.toString()
    };

    const walletAdapter = config.platform === 'web' ? webWallet : platformAdapter.current;
    const status = await blockchainService.current.executeTransaction(request, walletAdapter);
    
    setTransactions(prev => new Map(prev).set(status.signature, status));
    
    return status;
  }, [publicKey, config.platform, config.userId, webWallet]);

  // Create game (admin only)
  const createGame = useCallback(async (params: any): Promise<TransactionStatus> => {
    if (!blockchainService.current) {
      throw new Error('Blockchain service not initialized');
    }

    if (config.platform !== 'web') {
      throw new Error('Game creation only allowed from web platform');
    }

    const request: TransactionRequest = {
      platform: config.platform,
      type: 'create_game',
      userId: config.userId || 'admin',
      params
    };

    const status = await blockchainService.current.executeTransaction(request, webWallet);
    
    setTransactions(prev => new Map(prev).set(status.signature, status));
    
    return status;
  }, [config.platform, config.userId, webWallet]);

  // Get game state
  const getGame = useCallback(async (gameId: string): Promise<GameState | null> => {
    if (!blockchainService.current) return null;
    return await blockchainService.current.getGame(gameId);
  }, []);

  // Get player list
  const getPlayerList = useCallback(async (gameId: string): Promise<Player[]> => {
    if (!blockchainService.current) return [];
    return await blockchainService.current.getPlayerList(gameId);
  }, []);

  // Refresh game data
  const refreshGame = useCallback(async (gameId: string) => {
    // This would trigger a re-fetch of game data
    // Implementation depends on state management approach
    await getGame(gameId);
    await getPlayerList(gameId);
  }, [getGame, getPlayerList]);

  // Event handlers
  const handleWalletUpdate = useCallback((data: WalletState) => {
    if (data.publicKey) {
      setPublicKey(new PublicKey(data.publicKey));
    }
    setBalance(data.balance);
  }, []);

  const handleTransactionUpdate = useCallback((data: TransactionStatus) => {
    setTransactions(prev => {
      const updated = new Map(prev);
      updated.set(data.signature, data);
      return updated;
    });
  }, []);

  const handleGameEvent = useCallback((data: any) => {
    // Handle game events (could trigger notifications, refetch data, etc.)
    console.log('Game event:', data);
  }, []);

  // Get pending transactions
  const pendingTransactions = Array.from(transactions.values()).filter(
    tx => tx.status === 'pending' || tx.status === 'processing'
  );

  // Update web wallet connection state
  useEffect(() => {
    if (config.platform === 'web') {
      setConnected(webWallet.connected);
      setPublicKey(webWallet.publicKey);
    }
  }, [config.platform, webWallet.connected, webWallet.publicKey]);

  return {
    connected,
    connecting,
    publicKey,
    balance,
    connect,
    disconnect,
    joinGame,
    selectNumber,
    claimPrize,
    createGame,
    getGame,
    getPlayerList,
    transactions,
    pendingTransactions,
    refreshBalance,
    refreshGame
  };
}