import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export const Transactions: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Transactions
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            Transaction history and payment management will be implemented here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};