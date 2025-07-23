import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import dashboardReducer from './slices/dashboardSlice';
import gamesReducer from './slices/gamesSlice';
import analyticsReducer from './slices/analyticsSlice';
import playersReducer from './slices/playersSlice';
import transactionsReducer from './slices/transactionsSlice';
import configReducer from './slices/configSlice';
import systemReducer from './slices/systemSlice';
import notificationReducer from './slices/notificationSlice';
import blockchainReducer from './slices/blockchainSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    dashboard: dashboardReducer,
    games: gamesReducer,
    analytics: analyticsReducer,
    players: playersReducer,
    transactions: transactionsReducer,
    config: configReducer,
    system: systemReducer,
    notification: notificationReducer,
    blockchain: blockchainReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;