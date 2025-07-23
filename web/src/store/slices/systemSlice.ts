import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SystemEvent, Alert } from '../../types';

interface SystemState {
  events: SystemEvent[];
  alerts: Alert[];
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  loading: boolean;
  error: string | null;
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: {
      [key: string]: {
        status: 'up' | 'down';
        lastCheck: string;
      };
    };
  };
}

const initialState: SystemState = {
  events: [],
  alerts: [],
  maintenanceMode: false,
  loading: false,
  error: null,
  health: {
    status: 'healthy',
    services: {},
  },
};

const systemSlice = createSlice({
  name: 'system',
  initialState,
  reducers: {
    setEvents: (state, action: PayloadAction<SystemEvent[]>) => {
      state.events = action.payload;
    },
    addEvent: (state, action: PayloadAction<SystemEvent>) => {
      state.events.unshift(action.payload);
    },
    setAlerts: (state, action: PayloadAction<Alert[]>) => {
      state.alerts = action.payload;
    },
    setMaintenanceMode: (state, action: PayloadAction<{ enabled: boolean; message?: string }>) => {
      state.maintenanceMode = action.payload.enabled;
      state.maintenanceMessage = action.payload.message;
    },
    setHealth: (state, action: PayloadAction<SystemState['health']>) => {
      state.health = action.payload;
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
  setEvents,
  addEvent,
  setAlerts,
  setMaintenanceMode,
  setHealth,
  setLoading,
  setError,
} = systemSlice.actions;

export default systemSlice.reducer;