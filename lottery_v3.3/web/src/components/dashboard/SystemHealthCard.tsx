import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  LinearProgress,
  Chip,
  Stack,
} from '@mui/material';
import {
  CheckCircle,
  Warning,
  Error,
} from '@mui/icons-material';

interface SystemHealthCardProps {
  metrics?: {
    cpuUsage: number;
    memoryUsage: number;
    uptime: number;
    errorRate: number;
  };
}

export const SystemHealthCard: React.FC<SystemHealthCardProps> = ({ metrics }) => {
  const getHealthStatus = () => {
    if (!metrics) return { status: 'unknown', color: 'default', icon: <Warning /> };
    
    const { cpuUsage, memoryUsage, errorRate } = metrics;
    
    if (cpuUsage > 90 || memoryUsage > 90 || errorRate > 5) {
      return { status: 'critical', color: 'error', icon: <Error /> };
    }
    if (cpuUsage > 70 || memoryUsage > 70 || errorRate > 2) {
      return { status: 'warning', color: 'warning', icon: <Warning /> };
    }
    return { status: 'healthy', color: 'success', icon: <CheckCircle /> };
  };

  const healthStatus = getHealthStatus();

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">System Health</Typography>
          <Chip
            icon={healthStatus.icon}
            label={healthStatus.status.toUpperCase()}
            color={healthStatus.color as any}
            size="small"
          />
        </Box>

        <Stack spacing={2}>
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                CPU Usage
              </Typography>
              <Typography variant="body2">
                {metrics?.cpuUsage || 0}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={metrics?.cpuUsage || 0}
              color={metrics && metrics.cpuUsage > 70 ? 'warning' : 'primary'}
            />
          </Box>

          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Memory Usage
              </Typography>
              <Typography variant="body2">
                {metrics?.memoryUsage || 0}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={metrics?.memoryUsage || 0}
              color={metrics && metrics.memoryUsage > 70 ? 'warning' : 'primary'}
            />
          </Box>

          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Error Rate
              </Typography>
              <Typography variant="body2">
                {metrics?.errorRate || 0}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={metrics?.errorRate || 0}
              color={metrics && metrics.errorRate > 2 ? 'error' : 'primary'}
            />
          </Box>

          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Uptime: {metrics ? `${(metrics.uptime / 3600).toFixed(1)}h` : 'N/A'}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};