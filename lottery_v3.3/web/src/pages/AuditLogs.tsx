import React from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';

export const AuditLogs: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Audit Logs
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            Audit log viewer will be implemented here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};