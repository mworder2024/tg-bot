import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Game } from '../../types';

interface GamesState {
  games: Game[];
  loading: boolean;
  error: string | null;
  filters: {
    status?: string;
    isPaid?: boolean;
    dateFrom?: string;
    dateTo?: string;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

const initialState: GamesState = {
  games: [],
  loading: false,
  error: null,
  filters: {},
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
  },
};

const gamesSlice = createSlice({
  name: 'games',
  initialState,
  reducers: {
    setGames: (state, action: PayloadAction<{ games: Game[]; total: number }>) => {
      state.games = action.payload.games;
      state.pagination.total = action.payload.total;
      state.error = null;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.loading = false;
    },
    setFilters: (state, action: PayloadAction<Partial<GamesState['filters']>>) => {
      state.filters = { ...state.filters, ...action.payload };
      state.pagination.page = 1; // Reset to first page when filters change
    },
    setPagination: (state, action: PayloadAction<Partial<GamesState['pagination']>>) => {
      state.pagination = { ...state.pagination, ...action.payload };
    },
    updateGame: (state, action: PayloadAction<Game>) => {
      const index = state.games.findIndex(g => g.id === action.payload.id);
      if (index !== -1) {
        state.games[index] = action.payload;
      }
    },
  },
});

export const {
  setGames,
  setLoading,
  setError,
  setFilters,
  setPagination,
  updateGame,
} = gamesSlice.actions;

export default gamesSlice.reducer;