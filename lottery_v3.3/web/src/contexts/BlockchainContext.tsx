/**
 * Blockchain Context Provider
 * Manages blockchain connections and provides unified interface across platforms
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
  LedgerWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';

import { getBlockchainService, BlockchainService, Platform } from '../services/blockchain';
import { getBlockchainWebSocket, BlockchainWebSocket } from '../services/blockchain/websocket';
import { useBlockchain, UseBlockchainReturn } from '../hooks/useBlockchain';
import {
  setConnected,
  updateWallet,
  updateTransaction,
  updateGame,
  updateNetworkStats,
  setWsConnected,
  setWsReconnecting,
  selectBlockchainState
} from '../store/slices/blockchainSlice';
import { AppDispatch, RootState } from '../store';

// Context interfaces
interface BlockchainContextValue extends UseBlockchainReturn {
  service: BlockchainService | null;
  websocket: BlockchainWebSocket | null;
  platform: Platform;
  isInitialized: boolean;
}

// Create context
const BlockchainContext = createContext<BlockchainContextValue | null>(null);

// Provider props
interface BlockchainProviderProps {
  children: React.ReactNode;
  platform?: Platform;
  userId?: string;
  autoConnect?: boolean;
}

/**
 * Blockchain Provider Component
 */
export const BlockchainProvider: React.FC<BlockchainProviderProps> = ({
  children,
  platform = 'web',
  userId,
  autoConnect = false
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const blockchainState = useSelector(selectBlockchainState);
  const [isInitialized, setIsInitialized] = useState(false);
  const [service, setService] = useState<BlockchainService | null>(null);
  const [websocket, setWebsocket] = useState<BlockchainWebSocket | null>(null);

  // Determine network from environment
  const network = process.env.REACT_APP_SOLANA_NETWORK === 'devnet' 
    ? WalletAdapterNetwork.Devnet 
    : WalletAdapterNetwork.Mainnet;

  // RPC endpoint
  const endpoint = process.env.REACT_APP_SOLANA_RPC_URL || clusterApiUrl(network);

  // Wallet adapters for web platform
  const wallets = React.useMemo(
    () => platform === 'web' ? [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network }),
      new TorusWalletAdapter(),
      new LedgerWalletAdapter(),
    ] : [],
    [network, platform]
  );

  // Initialize blockchain service
  useEffect(() => {
    const initializeService = async () => {
      try {
        // Service configuration
        const config = {
          rpcUrl: endpoint,
          programId: process.env.REACT_APP_PROGRAM_ID || '',
          tokenMint: process.env.REACT_APP_TOKEN_MINT || '',
          vfrOracle: process.env.REACT_APP_VFR_ORACLE || '',
          websocketUrl: process.env.REACT_APP_BLOCKCHAIN_WS_URL,
          network
        };

        // Initialize service
        const blockchainService = getBlockchainService(config);
        await blockchainService.initialize(platform);
        setService(blockchainService);

        // Initialize WebSocket if URL provided
        if (config.websocketUrl) {
          const ws = getBlockchainWebSocket({
            url: config.websocketUrl,
            reconnectInterval: 5000,
            maxReconnectAttempts: 10
          });

          // Setup WebSocket event handlers
          ws.on('connected', () => dispatch(setWsConnected(true)));
          ws.on('disconnected', () => dispatch(setWsConnected(false)));
          ws.on('reconnecting', () => dispatch(setWsReconnecting(true)));
          ws.on('error', (error) => console.error('WebSocket error:', error));

          // Handle blockchain events
          ws.on('transaction_update', (data) => {
            dispatch(updateTransaction({
              ...data,
              timestamp: new Date().toISOString()
            }));
          });

          ws.on('game_created', (data) => {
            dispatch(updateGame({
              gameId: data.gameId,
              state: data,
              players: []
            }));
          });

          ws.on('player_joined', (data) => {
            // Refetch game data
            blockchainService.getGame(data.gameId).then(game => {
              if (game) {
                blockchainService.getPlayerList(data.gameId).then(players => {
                  dispatch(updateGame({
                    gameId: data.gameId,
                    state: game,
                    players
                  }));
                });
              }
            });
          });

          ws.on('game_completed', (data) => {
            // Refetch game data
            blockchainService.getGame(data.gameId).then(game => {
              if (game) {
                blockchainService.getPlayerList(data.gameId).then(players => {
                  dispatch(updateGame({
                    gameId: data.gameId,
                    state: game,
                    players
                  }));
                });
              }
            });
          });

          ws.on('blockchain_stats', (data) => {
            dispatch(updateNetworkStats(data));
          });

          ws.connect();
          setWebsocket(ws);
        }

        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize blockchain service:', error);
      }
    };

    initializeService();

    // Cleanup
    return () => {
      websocket?.disconnect();
    };
  }, [platform, network, endpoint, dispatch]);

  // Use blockchain hook
  const blockchain = useBlockchain({
    platform,
    userId,
    autoConnect,
    onError: (error) => {
      console.error('Blockchain error:', error);
      // Could dispatch error to Redux or show notification
    }
  });

  // Sync wallet state with Redux
  useEffect(() => {
    if (blockchain.connected && blockchain.publicKey) {
      dispatch(setConnected(true));
      dispatch(updateWallet({
        address: blockchain.publicKey.toString(),
        balance: blockchain.balance
      }));
    } else {
      dispatch(setConnected(false));
    }
  }, [blockchain.connected, blockchain.publicKey, blockchain.balance, dispatch]);

  // Context value
  const contextValue: BlockchainContextValue = {
    ...blockchain,
    service,
    websocket,
    platform,
    isInitialized
  };

  // For web platform, wrap in Solana wallet providers
  if (platform === 'web') {
    return (
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect={autoConnect}>
          <WalletModalProvider>
            <BlockchainContext.Provider value={contextValue}>
              {children}
            </BlockchainContext.Provider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    );
  }

  // For other platforms, just provide context
  return (
    <BlockchainContext.Provider value={contextValue}>
      {children}
    </BlockchainContext.Provider>
  );
};

/**
 * Hook to use blockchain context
 */
export const useBlockchainContext = (): BlockchainContextValue => {
  const context = useContext(BlockchainContext);
  if (!context) {
    throw new Error('useBlockchainContext must be used within BlockchainProvider');
  }
  return context;
};

/**
 * HOC to inject blockchain props
 */
export function withBlockchain<P extends object>(
  Component: React.ComponentType<P & BlockchainContextValue>
): React.FC<P> {
  return (props: P) => {
    const blockchain = useBlockchainContext();
    return <Component {...props} {...blockchain} />;
  };
}