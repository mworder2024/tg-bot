import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export const Games: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Games Management
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            Game management interface will be implemented here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};