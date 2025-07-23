import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Configuration } from '../../types';

interface ConfigState {
  configurations: Configuration[];
  loading: boolean;
  error: string | null;
  categories: string[];
}

const initialState: ConfigState = {
  configurations: [],
  loading: false,
  error: null,
  categories: [],
};

const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    setConfigurations: (state, action: PayloadAction<Configuration[]>) => {
      state.configurations = action.payload;
      state.categories = [...new Set(action.payload.map(c => c.category || 'General'))];
      state.error = null;
    },
    updateConfiguration: (state, action: PayloadAction<Configuration>) => {
      const index = state.configurations.findIndex(c => c.key === action.payload.key);
      if (index !== -1) {
        state.configurations[index] = action.payload;
      }
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
  setConfigurations,
  updateConfiguration,
  setLoading,
  setError,
} = configSlice.actions;

export default configSlice.reducer;