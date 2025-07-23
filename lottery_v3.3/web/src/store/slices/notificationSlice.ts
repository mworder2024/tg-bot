import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { NotificationState } from '../../types';

const initialState: NotificationState = {
  open: false,
  message: '',
  severity: 'info',
};

const notificationSlice = createSlice({
  name: 'notification',
  initialState,
  reducers: {
    showNotification: (
      state,
      action: PayloadAction<{
        message: string;
        severity: 'success' | 'error' | 'warning' | 'info';
      }>
    ) => {
      state.open = true;
      state.message = action.payload.message;
      state.severity = action.payload.severity;
    },
    hideNotification: (state) => {
      state.open = false;
    },
  },
});

export const { showNotification, hideNotification } = notificationSlice.actions;
export default notificationSlice.reducer;