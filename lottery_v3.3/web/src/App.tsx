import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Box } from '@mui/material';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Games } from './pages/Games';
import { Analytics } from './pages/Analytics';
import { Players } from './pages/Players';
import { Transactions } from './pages/Transactions';
import { Configuration } from './pages/Configuration';
import { SystemEvents } from './pages/SystemEvents';
import { AdminUsers } from './pages/AdminUsers';
import { AuditLogs } from './pages/AuditLogs';
import { LogViewer } from './pages/LogViewer';
import { BlockchainMonitor } from './pages/BlockchainMonitor';
import { GameMonitor } from './pages/GameMonitor';
import { PrivateRoute } from './components/PrivateRoute';
import { MainLayout } from './components/layouts/MainLayout';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import { initializeWebSocket } from './services/websocket';
import { AppDispatch } from './store';

function AppContent() {
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, token } = useAuth();

  useEffect(() => {
    if (isAuthenticated && token) {
      const cleanup = initializeWebSocket(token, dispatch);
      return cleanup;
    }
  }, [isAuthenticated, token, dispatch]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <MainLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="games" element={<Games />} />
          <Route path="game-monitor" element={<GameMonitor />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="players" element={<Players />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="blockchain-monitor" element={<BlockchainMonitor />} />
          <Route path="logs" element={<LogViewer />} />
          <Route path="configuration" element={<Configuration />} />
          <Route path="system-events" element={<SystemEvents />} />
          <Route path="admin-users" element={<AdminUsers />} />
          <Route path="audit-logs" element={<AuditLogs />} />
        </Route>
      </Routes>
    </Box>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;