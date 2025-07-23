import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Transaction } from '../../types';

interface TransactionsState {
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  filters: {
    status?: string;
    type?: string;
    userId?: string;
    gameId?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

const initialState: TransactionsState = {
  transactions: [],
  loading: false,
  error: null,
  filters: {},
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
  },
};

const transactionsSlice = createSlice({
  name: 'transactions',
  initialState,
  reducers: {
    setTransactions: (state, action: PayloadAction<{ transactions: Transaction[]; total: number }>) => {
      state.transactions = action.payload.transactions;
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
    setFilters: (state, action: PayloadAction<Partial<TransactionsState['filters']>>) => {
      state.filters = { ...state.filters, ...action.payload };
      state.pagination.page = 1;
    },
    setPagination: (state, action: PayloadAction<Partial<TransactionsState['pagination']>>) => {
      state.pagination = { ...state.pagination, ...action.payload };
    },
  },
});

export const {
  setTransactions,
  setLoading,
  setError,
  setFilters,
  setPagination,
} = transactionsSlice.actions;

export default transactionsSlice.reducer;