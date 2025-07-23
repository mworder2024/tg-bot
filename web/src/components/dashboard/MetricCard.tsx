import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  TrendingFlat,
} from '@mui/icons-material';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  trend?: number;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  color,
  trend,
}) => {
  const getTrendIcon = () => {
    if (!trend) return <TrendingFlat />;
    if (trend > 0) return <TrendingUp />;
    return <TrendingDown />;
  };

  const getTrendColor = () => {
    if (!trend) return 'default';
    if (trend > 0) return 'success';
    return 'error';
  };

  return (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'visible' }}>
      <CardContent>
        <Box
          sx={{
            position: 'absolute',
            top: -20,
            left: 20,
            width: 64,
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 2,
            bgcolor: color,
            color: 'white',
            boxShadow: 3,
          }}
        >
          {icon}
        </Box>

        <Box sx={{ ml: 10, mt: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {title}
          </Typography>
          <Typography variant="h4" component="div">
            {value}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {subtitle}
            </Typography>
          )}
          {trend !== undefined && (
            <Chip
              icon={getTrendIcon()}
              label={`${Math.abs(trend).toFixed(1)}%`}
              size="small"
              color={getTrendColor() as any}
              sx={{ mt: 1 }}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
};