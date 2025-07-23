import { io, Socket } from 'socket.io-client';
import { AppDispatch } from '../store';
import { setMetrics, setConnected } from '../store/slices/dashboardSlice';
import { showNotification } from '../store/slices/notificationSlice';
import {
  MetricsUpdateEvent,
  GameCancelledEvent,
  ConfigUpdatedEvent,
  SystemMaintenanceEvent,
} from '../types';

let socket: Socket | null = null;

export const initializeWebSocket = (token: string, dispatch: AppDispatch) => {
  const wsUrl = process.env.REACT_APP_WS_URL || 'ws://localhost:4000';

  socket = io(wsUrl, {
    auth: {
      token,
    },
  });

  socket.on('connect', () => {
    console.log('WebSocket connected');
    dispatch(setConnected(true));
    
    // Join rooms
    socket?.emit('join:metrics');
    socket?.emit('join:alerts');
    socket?.emit('join:config');
  });

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
    dispatch(setConnected(false));
  });

  socket.on('metrics:update', (data: MetricsUpdateEvent) => {
    dispatch(setMetrics(data.metrics));
  });

  socket.on('game:cancelled', (data: GameCancelledEvent) => {
    dispatch(
      showNotification({
        message: `Game ${data.gameId} cancelled: ${data.reason}`,
        severity: 'warning',
      })
    );
  });

  socket.on('config:updated', (data: ConfigUpdatedEvent) => {
    dispatch(
      showNotification({
        message: `Configuration updated: ${data.key}`,
        severity: 'info',
      })
    );
  });

  socket.on('system:maintenance', (data: SystemMaintenanceEvent) => {
    dispatch(
      showNotification({
        message: data.enabled
          ? `System maintenance enabled: ${data.message}`
          : 'System maintenance disabled',
        severity: data.enabled ? 'warning' : 'success',
      })
    );
  });

  socket.on('error', (error) => {
    console.error('WebSocket error:', error);
    dispatch(
      showNotification({
        message: 'WebSocket connection error',
        severity: 'error',
      })
    );
  });

  return () => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  };
};

export const getSocket = () => socket;