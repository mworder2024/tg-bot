import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export const Analytics: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Analytics
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            Analytics dashboard with charts and insights will be implemented here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};