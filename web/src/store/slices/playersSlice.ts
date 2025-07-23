import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Player } from '../../types';

interface PlayersState {
  players: Player[];
  loading: boolean;
  error: string | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

const initialState: PlayersState = {
  players: [],
  loading: false,
  error: null,
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
  },
};

const playersSlice = createSlice({
  name: 'players',
  initialState,
  reducers: {
    setPlayers: (state, action: PayloadAction<{ players: Player[]; total: number }>) => {
      state.players = action.payload.players;
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
    setPagination: (state, action: PayloadAction<Partial<PlayersState['pagination']>>) => {
      state.pagination = { ...state.pagination, ...action.payload };
    },
  },
});

export const { setPlayers, setLoading, setError, setPagination } = playersSlice.actions;
export default playersSlice.reducer;