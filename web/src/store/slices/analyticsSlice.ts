import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { GameAnalytics, RevenueAnalytics } from '../../types';

interface AnalyticsState {
  gameAnalytics: GameAnalytics[];
  revenueAnalytics: RevenueAnalytics[];
  loading: boolean;
  error: string | null;
  dateRange: {
    from: string;
    to: string;
  };
}

const initialState: AnalyticsState = {
  gameAnalytics: [],
  revenueAnalytics: [],
  loading: false,
  error: null,
  dateRange: {
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date().toISOString(),
  },
};

const analyticsSlice = createSlice({
  name: 'analytics',
  initialState,
  reducers: {
    setGameAnalytics: (state, action: PayloadAction<GameAnalytics[]>) => {
      state.gameAnalytics = action.payload;
    },
    setRevenueAnalytics: (state, action: PayloadAction<RevenueAnalytics[]>) => {
      state.revenueAnalytics = action.payload;
    },
    setDateRange: (state, action: PayloadAction<{ from: string; to: string }>) => {
      state.dateRange = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.loading = false;
    },
  },
});

export const {
  setGameAnalytics,
  setRevenueAnalytics,
  setDateRange,
  setLoading,
  setError,
} = analyticsSlice.actions;

export default analyticsSlice.reducer;