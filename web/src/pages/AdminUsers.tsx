import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export const AdminUsers: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Admin Users
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            Admin user management interface will be implemented here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};