import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export const Players: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Players
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            Player management and leaderboard will be implemented here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};