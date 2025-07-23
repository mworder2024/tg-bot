import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { DashboardState, RealtimeMetrics } from '../../types';

const initialState: DashboardState = {
  metrics: null,
  loading: false,
  error: null,
  connected: false,
};

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    setMetrics: (state, action: PayloadAction<RealtimeMetrics>) => {
      state.metrics = action.payload;
      state.error = null;
    },
    setConnected: (state, action: PayloadAction<boolean>) => {
      state.connected = action.payload;
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

export const { setMetrics, setConnected, setLoading, setError } = dashboardSlice.actions;
export default dashboardSlice.reducer;