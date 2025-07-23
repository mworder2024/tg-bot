import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  CircularProgress,
  Chip,
  LinearProgress,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  People,
  SportsEsports,
  Payment,
  Memory,
} from '@mui/icons-material';
import { RootState, AppDispatch } from '../store';
import { MetricCard } from '../components/dashboard/MetricCard';
import { RealtimeChart } from '../components/dashboard/RealtimeChart';
import { SystemHealthCard } from '../components/dashboard/SystemHealthCard';
import { RecentActivityCard } from '../components/dashboard/RecentActivityCard';
import { fetchRealtimeMetrics } from '../services/api/metrics';
import { setMetrics, setLoading, setError } from '../store/slices/dashboardSlice';

export const Dashboard: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { metrics, loading, error, connected } = useSelector(
    (state: RootState) => state.dashboard
  );

  useEffect(() => {
    const loadMetrics = async () => {
      dispatch(setLoading(true));
      try {
        const response = await fetchRealtimeMetrics();
        if (response.success && response.data) {
          dispatch(setMetrics(response.data));
        } else {
          dispatch(setError(response.error?.message || 'Failed to load metrics'));
        }
      } catch (err: any) {
        dispatch(setError(err.message || 'Failed to load metrics'));
      } finally {
        dispatch(setLoading(false));
      }
    };

    loadMetrics();
    const interval = setInterval(loadMetrics, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [dispatch]);

  if (loading && !metrics) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          Dashboard
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Chip
            label={connected ? 'Connected' : 'Disconnected'}
            color={connected ? 'success' : 'error'}
            size="small"
          />
          <Chip
            label={`Last update: ${metrics ? new Date(metrics.timestamp).toLocaleTimeString() : 'N/A'}`}
            size="small"
          />
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Metric Cards */}
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Active Games"
            value={metrics?.games.active || 0}
            subtitle={`${metrics?.games.total24h || 0} total today`}
            icon={<SportsEsports />}
            color="#1976d2"
            trend={metrics?.games.total24h ? 
              ((metrics.games.total24h - (metrics.games.total24h * 0.9)) / (metrics.games.total24h * 0.9) * 100) : 0
            }
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Online Players"
            value={metrics?.players.online || 0}
            subtitle={`${metrics?.players.total24h || 0} unique today`}
            icon={<People />}
            color="#388e3c"
            trend={metrics?.players.total24h ? 
              ((metrics.players.total24h - (metrics.players.total24h * 0.85)) / (metrics.players.total24h * 0.85) * 100) : 0
            }
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="Payment Volume"
            value={`$${(metrics?.payments.volume24h || 0).toFixed(2)}`}
            subtitle={`${metrics?.payments.confirmed24h || 0} confirmed`}
            icon={<Payment />}
            color="#f57c00"
            trend={metrics?.payments.volume24h ? 
              ((metrics.payments.volume24h - (metrics.payments.volume24h * 0.95)) / (metrics.payments.volume24h * 0.95) * 100) : 0
            }
          />
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <MetricCard
            title="System Health"
            value={`${100 - (metrics?.system.errorRate || 0)}%`}
            subtitle={`${(metrics?.system.uptime || 0) / 3600}h uptime`}
            icon={<Memory />}
            color="#d32f2f"
            trend={-(metrics?.system.errorRate || 0)}
          />
        </Grid>

        {/* Charts */}
        <Grid item xs={12} lg={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Activity Overview
              </Typography>
              <Box sx={{ height: 300 }}>
                <RealtimeChart />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={4}>
          <SystemHealthCard metrics={metrics?.system} />
        </Grid>

        {/* Recent Activity */}
        <Grid item xs={12}>
          <RecentActivityCard />
        </Grid>
      </Grid>
    </Box>
  );
};