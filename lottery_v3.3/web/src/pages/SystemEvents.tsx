import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export const SystemEvents: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        System Events
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            System event logs and alerts will be displayed here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};