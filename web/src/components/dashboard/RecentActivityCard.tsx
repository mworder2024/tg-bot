import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Chip,
  Box,
  Divider,
} from '@mui/material';
import {
  SportsEsports,
  Payment,
  PersonAdd,
  Warning,
  CheckCircle,
  Cancel,
} from '@mui/icons-material';

interface Activity {
  id: string;
  type: 'game_started' | 'game_completed' | 'payment_received' | 'player_joined' | 'error' | 'game_cancelled';
  message: string;
  timestamp: string;
  metadata?: any;
}

// Mock data - in real app, this would come from the API
const mockActivities: Activity[] = [
  {
    id: '1',
    type: 'game_started',
    message: 'New game started with 25 players',
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: '2',
    type: 'payment_received',
    message: 'Payment confirmed: 10 MWOR from player123',
    timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: '3',
    type: 'game_completed',
    message: 'Game #12345 completed - 3 winners',
    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: '4',
    type: 'player_joined',
    message: 'New player registered: alice_crypto',
    timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    id: '5',
    type: 'error',
    message: 'Payment timeout for transaction 0xabc...',
    timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
];

export const RecentActivityCard: React.FC = () => {
  const getActivityIcon = (type: Activity['type']) => {
    switch (type) {
      case 'game_started':
        return { icon: <SportsEsports />, color: '#1976d2' };
      case 'game_completed':
        return { icon: <CheckCircle />, color: '#388e3c' };
      case 'payment_received':
        return { icon: <Payment />, color: '#f57c00' };
      case 'player_joined':
        return { icon: <PersonAdd />, color: '#7b1fa2' };
      case 'error':
        return { icon: <Warning />, color: '#d32f2f' };
      case 'game_cancelled':
        return { icon: <Cancel />, color: '#f44336' };
      default:
        return { icon: <SportsEsports />, color: '#757575' };
    }
  };

  const getRelativeTime = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Recent Activity</Typography>
          <Chip label="Live" color="success" size="small" />
        </Box>
        
        <List sx={{ width: '100%' }}>
          {mockActivities.map((activity, index) => {
            const { icon, color } = getActivityIcon(activity.type);
            return (
              <React.Fragment key={activity.id}>
                <ListItem alignItems="flex-start" sx={{ px: 0 }}>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: color }}>
                      {icon}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={activity.message}
                    secondary={getRelativeTime(activity.timestamp)}
                  />
                </ListItem>
                {index < mockActivities.length - 1 && <Divider variant="inset" component="li" />}
              </React.Fragment>
            );
          })}
        </List>
      </CardContent>
    </Card>
  );
};