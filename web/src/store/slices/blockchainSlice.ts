/**
 * Redux slice for blockchain state management
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { PublicKey } from '@solana/web3.js';
import { GameState, Player } from '../../../../src/blockchain/lottery-sdk';
import { getBlockchainService, TransactionStatus, Platform } from '../../services/blockchain';

// State interfaces
export interface BlockchainWallet {
  address: string;
  balance: {
    sol: number;
    mwor: number;
  };
  lastUpdated: string;
}

export interface BlockchainTransaction {
  signature: string;
  type: 'join_game' | 'claim_prize' | 'create_game' | 'select_number';
  status: 'pending' | 'processing' | 'confirmed' | 'failed';
  error?: string;
  gameId?: string;
  amount?: number;
  timestamp: string;
  confirmations?: number;
}

export interface BlockchainGame {
  gameId: string;
  state: GameState;
  players: Player[];
  lastUpdated: string;
  isMonitoring: boolean;
}

export interface BlockchainStats {
  slot: number;
  blockHeight: number;
  tps: number;
  epochProgress: number;
  connected: boolean;
  lastUpdated: string;
}

export interface BlockchainState {
  // Connection
  platform: Platform;
  connected: boolean;
  connecting: boolean;
  error: string | null;

  // Wallet
  wallet: BlockchainWallet | null;

  // Games
  games: Record<string, BlockchainGame>;
  activeGameId: string | null;

  // Transactions
  transactions: Record<string, BlockchainTransaction>;
  pendingTransactions: string[];

  // Network stats
  networkStats: BlockchainStats | null;

  // WebSocket
  wsConnected: boolean;
  wsReconnecting: boolean;
}

// Initial state
const initialState: BlockchainState = {
  platform: 'web',
  connected: false,
  connecting: false,
  error: null,
  wallet: null,
  games: {},
  activeGameId: null,
  transactions: {},
  pendingTransactions: [],
  networkStats: null,
  wsConnected: false,
  wsReconnecting: false
};

// Async thunks
export const connectWallet = createAsyncThunk(
  'blockchain/connectWallet',
  async ({ platform, userId }: { platform: Platform; userId?: string }) => {
    const service = getBlockchainService();
    await service.initialize(platform);
    // Connection handled by platform-specific adapters
    return { platform };
  }
);

export const fetchWalletBalance = createAsyncThunk(
  'blockchain/fetchWalletBalance',
  async (address: string) => {
    const service = getBlockchainService();
    const balance = await service.getWalletBalance(address);
    return { address, balance };
  }
);

export const fetchGame = createAsyncThunk(
  'blockchain/fetchGame',
  async (gameId: string) => {
    const service = getBlockchainService();
    const [state, players] = await Promise.all([
      service.getGame(gameId),
      service.getPlayerList(gameId)
    ]);
    
    if (!state) {
      throw new Error('Game not found');
    }
    
    return { gameId, state, players };
  }
);

export const joinGame = createAsyncThunk(
  'blockchain/joinGame',
  async ({ 
    gameId, 
    walletAddress, 
    telegramId,
    platform,
    userId 
  }: {
    gameId: string;
    walletAddress: string;
    telegramId?: string;
    platform: Platform;
    userId: string;
  }) => {
    const service = getBlockchainService();
    const status = await service.executeTransaction({
      platform,
      type: 'join_game',
      gameId,
      userId,
      walletAddress,
      params: { telegramId }
    });
    
    return { gameId, transaction: status };
  }
);

export const selectNumber = createAsyncThunk(
  'blockchain/selectNumber',
  async ({
    gameId,
    number,
    walletAddress,
    platform,
    userId
  }: {
    gameId: string;
    number: number;
    walletAddress: string;
    platform: Platform;
    userId: string;
  }) => {
    const service = getBlockchainService();
    const status = await service.executeTransaction({
      platform,
      type: 'select_number',
      gameId,
      userId,
      walletAddress,
      params: { number }
    });
    
    return { gameId, transaction: status };
  }
);

export const claimPrize = createAsyncThunk(
  'blockchain/claimPrize',
  async ({
    gameId,
    walletAddress,
    platform,
    userId
  }: {
    gameId: string;
    walletAddress: string;
    platform: Platform;
    userId: string;
  }) => {
    const service = getBlockchainService();
    const status = await service.executeTransaction({
      platform,
      type: 'claim_prize',
      gameId,
      userId,
      walletAddress
    });
    
    return { gameId, transaction: status };
  }
);

export const createGame = createAsyncThunk(
  'blockchain/createGame',
  async (params: {
    gameId: string;
    entryFee: number;
    maxPlayers: number;
    winnerCount: number;
    paymentDeadlineMinutes: number;
  }) => {
    const service = getBlockchainService();
    const status = await service.executeTransaction({
      platform: 'web', // Only web can create games
      type: 'create_game',
      userId: 'admin',
      params
    });
    
    return { transaction: status };
  }
);

// Slice
const blockchainSlice = createSlice({
  name: 'blockchain',
  initialState,
  reducers: {
    // Connection actions
    setPlatform: (state, action: PayloadAction<Platform>) => {
      state.platform = action.payload;
    },
    
    setConnected: (state, action: PayloadAction<boolean>) => {
      state.connected = action.payload;
      if (!action.payload) {
        state.wallet = null;
      }
    },

    // Wallet actions
    updateWallet: (state, action: PayloadAction<{
      address: string;
      balance: { sol: number; mwor: number };
    }>) => {
      state.wallet = {
        address: action.payload.address,
        balance: action.payload.balance,
        lastUpdated: new Date().toISOString()
      };
    },

    // Game actions
    setActiveGame: (state, action: PayloadAction<string | null>) => {
      state.activeGameId = action.payload;
    },

    updateGame: (state, action: PayloadAction<{
      gameId: string;
      state: GameState;
      players: Player[];
    }>) => {
      state.games[action.payload.gameId] = {
        gameId: action.payload.gameId,
        state: action.payload.state,
        players: action.payload.players,
        lastUpdated: new Date().toISOString(),
        isMonitoring: state.games[action.payload.gameId]?.isMonitoring || false
      };
    },

    setGameMonitoring: (state, action: PayloadAction<{
      gameId: string;
      monitoring: boolean;
    }>) => {
      if (state.games[action.payload.gameId]) {
        state.games[action.payload.gameId].isMonitoring = action.payload.monitoring;
      }
    },

    // Transaction actions
    updateTransaction: (state, action: PayloadAction<BlockchainTransaction>) => {
      const tx = action.payload;
      state.transactions[tx.signature] = tx;

      // Update pending transactions
      if (tx.status === 'pending' || tx.status === 'processing') {
        if (!state.pendingTransactions.includes(tx.signature)) {
          state.pendingTransactions.push(tx.signature);
        }
      } else {
        state.pendingTransactions = state.pendingTransactions.filter(
          sig => sig !== tx.signature
        );
      }
    },

    clearTransaction: (state, action: PayloadAction<string>) => {
      delete state.transactions[action.payload];
      state.pendingTransactions = state.pendingTransactions.filter(
        sig => sig !== action.payload
      );
    },

    // Network stats
    updateNetworkStats: (state, action: PayloadAction<Omit<BlockchainStats, 'lastUpdated'>>) => {
      state.networkStats = {
        ...action.payload,
        lastUpdated: new Date().toISOString()
      };
    },

    // WebSocket status
    setWsConnected: (state, action: PayloadAction<boolean>) => {
      state.wsConnected = action.payload;
    },

    setWsReconnecting: (state, action: PayloadAction<boolean>) => {
      state.wsReconnecting = action.payload;
    },

    // Error handling
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },

    clearError: (state) => {
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    // Connect wallet
    builder
      .addCase(connectWallet.pending, (state) => {
        state.connecting = true;
        state.error = null;
      })
      .addCase(connectWallet.fulfilled, (state, action) => {
        state.connecting = false;
        state.platform = action.payload.platform;
      })
      .addCase(connectWallet.rejected, (state, action) => {
        state.connecting = false;
        state.error = action.error.message || 'Failed to connect wallet';
      });

    // Fetch wallet balance
    builder
      .addCase(fetchWalletBalance.fulfilled, (state, action) => {
        if (state.wallet && state.wallet.address === action.payload.address) {
          state.wallet.balance = action.payload.balance;
          state.wallet.lastUpdated = new Date().toISOString();
        }
      });

    // Fetch game
    builder
      .addCase(fetchGame.fulfilled, (state, action) => {
        const { gameId, state: gameState, players } = action.payload;
        state.games[gameId] = {
          gameId,
          state: gameState,
          players,
          lastUpdated: new Date().toISOString(),
          isMonitoring: state.games[gameId]?.isMonitoring || false
        };
      })
      .addCase(fetchGame.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to fetch game';
      });

    // Join game
    builder
      .addCase(joinGame.pending, (state, action) => {
        const tx: BlockchainTransaction = {
          signature: '',
          type: 'join_game',
          status: 'pending',
          gameId: action.meta.arg.gameId,
          timestamp: new Date().toISOString()
        };
        state.transactions[action.meta.requestId] = tx;
        state.pendingTransactions.push(action.meta.requestId);
      })
      .addCase(joinGame.fulfilled, (state, action) => {
        const { transaction } = action.payload;
        delete state.transactions[action.meta.requestId];
        state.pendingTransactions = state.pendingTransactions.filter(
          id => id !== action.meta.requestId
        );
        
        state.transactions[transaction.signature] = {
          ...transaction,
          type: 'join_game',
          gameId: action.payload.gameId,
          timestamp: new Date().toISOString()
        };
        
        if (transaction.status === 'pending' || transaction.status === 'processing') {
          state.pendingTransactions.push(transaction.signature);
        }
      })
      .addCase(joinGame.rejected, (state, action) => {
        const tx = state.transactions[action.meta.requestId];
        if (tx) {
          tx.status = 'failed';
          tx.error = action.error.message;
        }
        state.pendingTransactions = state.pendingTransactions.filter(
          id => id !== action.meta.requestId
        );
      });

    // Similar handlers for selectNumber, claimPrize, createGame...
  }
});

// Export actions
export const {
  setPlatform,
  setConnected,
  updateWallet,
  setActiveGame,
  updateGame,
  setGameMonitoring,
  updateTransaction,
  clearTransaction,
  updateNetworkStats,
  setWsConnected,
  setWsReconnecting,
  setError,
  clearError
} = blockchainSlice.actions;

// Export reducer
export default blockchainSlice.reducer;

// Selectors
export const selectBlockchainState = (state: { blockchain: BlockchainState }) => state.blockchain;
export const selectWallet = (state: { blockchain: BlockchainState }) => state.blockchain.wallet;
export const selectActiveGame = (state: { blockchain: BlockchainState }) => {
  const { games, activeGameId } = state.blockchain;
  return activeGameId ? games[activeGameId] : null;
};
export const selectPendingTransactions = (state: { blockchain: BlockchainState }) => {
  const { transactions, pendingTransactions } = state.blockchain;
  return pendingTransactions.map(sig => transactions[sig]).filter(Boolean);
};
export const selectNetworkStats = (state: { blockchain: BlockchainState }) => state.blockchain.networkStats;