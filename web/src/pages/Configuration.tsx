import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export const Configuration: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Configuration
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            System configuration management will be implemented here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};