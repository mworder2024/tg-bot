import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  Chip,
  Paper,
  Button,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  InputAdornment,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Search,
  Clear,
  Pause,
  PlayArrow,
  Download,
  FilterList,
  BugReport,
  Info,
  Warning,
  Error,
  CheckCircle,
} from '@mui/icons-material';
import { format } from 'date-fns';
import axios from 'axios';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  service: string;
  component: string;
  message: string;
  metadata?: Record<string, any>;
  traceId?: string;
  spanId?: string;
  userId?: string;
  gameId?: string;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
}

const LOG_LEVELS = ['all', 'debug', 'info', 'warn', 'error', 'fatal'];
const SERVICES = ['all', 'bot', 'api', 'payment', 'blockchain', 'game', 'websocket'];

const levelColors = {
  debug: '#9e9e9e',
  info: '#2196f3',
  warn: '#ff9800',
  error: '#f44336',
  fatal: '#9c27b0',
};

const levelIcons = {
  debug: <BugReport fontSize="small" />,
  info: <Info fontSize="small" />,
  warn: <Warning fontSize="small" />,
  error: <Error fontSize="small" />,
  fatal: <Error fontSize="small" />,
};

export const LogViewer: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showMetadata, setShowMetadata] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Connect to WebSocket for real-time logs
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket('ws://localhost:4000/logs');
      
      ws.onopen = () => {
        console.log('Connected to log stream');
      };

      ws.onmessage = (event) => {
        if (!isPaused) {
          const logEntry = JSON.parse(event.data);
          setLogs(prev => [...prev.slice(-999), logEntry]); // Keep last 1000 logs
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('Disconnected from log stream');
        // Reconnect after 5 seconds
        setTimeout(connectWebSocket, 5000);
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isPaused]);

  // Filter logs
  useEffect(() => {
    let filtered = logs;

    // Level filter
    if (levelFilter !== 'all') {
      filtered = filtered.filter(log => log.level === levelFilter);
    }

    // Service filter
    if (serviceFilter !== 'all') {
      filtered = filtered.filter(log => log.service === serviceFilter);
    }

    // Search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(searchLower) ||
        log.component.toLowerCase().includes(searchLower) ||
        log.traceId?.toLowerCase().includes(searchLower) ||
        log.userId?.toLowerCase().includes(searchLower) ||
        log.gameId?.toLowerCase().includes(searchLower) ||
        JSON.stringify(log.metadata).toLowerCase().includes(searchLower)
      );
    }

    setFilteredLogs(filtered);
  }, [logs, levelFilter, serviceFilter, searchTerm]);

  // Auto scroll
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, autoScroll]);

  const handleDownload = () => {
    const dataStr = JSON.stringify(filteredLogs, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `logs_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const renderLogEntry = (log: LogEntry) => {
    return (
      <Paper
        key={log.id}
        sx={{
          p: 1.5,
          mb: 1,
          borderLeft: `4px solid ${levelColors[log.level]}`,
          backgroundColor: log.level === 'error' || log.level === 'fatal' ? 'rgba(244, 67, 54, 0.05)' : 'transparent',
        }}
      >
        <Grid container spacing={1} alignItems="flex-start">
          <Grid item xs={12}>
            <Box display="flex" alignItems="center" gap={1}>
              {levelIcons[log.level]}
              <Typography variant="caption" color="text.secondary">
                {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss.SSS')}
              </Typography>
              <Chip label={log.service} size="small" variant="outlined" />
              <Chip label={log.component} size="small" variant="outlined" />
              {log.traceId && (
                <Chip label={`trace: ${log.traceId.slice(0, 8)}`} size="small" />
              )}
              {log.userId && (
                <Chip label={`user: ${log.userId}`} size="small" color="primary" />
              )}
              {log.gameId && (
                <Chip label={`game: ${log.gameId}`} size="small" color="secondary" />
              )}
            </Box>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {log.message}
            </Typography>
          </Grid>
          {showMetadata && log.metadata && Object.keys(log.metadata).length > 0 && (
            <Grid item xs={12}>
              <Box sx={{ mt: 1, p: 1, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 1 }}>
                <Typography variant="caption" component="pre" sx={{ fontFamily: 'monospace' }}>
                  {JSON.stringify(log.metadata, null, 2)}
                </Typography>
              </Box>
            </Grid>
          )}
          {log.error && (
            <Grid item xs={12}>
              <Box sx={{ mt: 1, p: 1, backgroundColor: 'rgba(244, 67, 54, 0.1)', borderRadius: 1 }}>
                <Typography variant="caption" color="error" fontWeight="bold">
                  {log.error.name}: {log.error.message}
                </Typography>
                {showMetadata && (
                  <Typography variant="caption" component="pre" sx={{ fontFamily: 'monospace', mt: 1 }}>
                    {log.error.stack}
                  </Typography>
                )}
              </Box>
            </Grid>
          )}
        </Grid>
      </Paper>
    );
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          Real-time Log Viewer
        </Typography>
        <Box display="flex" gap={1}>
          <Chip
            label={`${filteredLogs.length} logs`}
            color="primary"
            variant="outlined"
          />
          <IconButton onClick={() => setIsPaused(!isPaused)} color={isPaused ? 'error' : 'primary'}>
            {isPaused ? <PlayArrow /> : <Pause />}
          </IconButton>
          <IconButton onClick={handleDownload}>
            <Download />
          </IconButton>
          <IconButton onClick={clearLogs} color="error">
            <Clear />
          </IconButton>
        </Box>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                  endAdornment: searchTerm && (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setSearchTerm('')}>
                        <Clear />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Level</InputLabel>
                <Select
                  value={levelFilter}
                  onChange={(e) => setLevelFilter(e.target.value)}
                  label="Level"
                >
                  {LOG_LEVELS.map(level => (
                    <MenuItem key={level} value={level}>{level}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Service</InputLabel>
                <Select
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(e.target.value)}
                  label="Service"
                >
                  {SERVICES.map(service => (
                    <MenuItem key={service} value={service}>{service}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={6} md={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                }
                label="Auto Scroll"
              />
            </Grid>
            <Grid item xs={6} md={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={showMetadata}
                    onChange={(e) => setShowMetadata(e.target.checked)}
                  />
                }
                label="Show Details"
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ maxHeight: '70vh', overflow: 'auto' }}>
          {filteredLogs.length === 0 ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
              <Typography color="text.secondary">
                {isPaused ? 'Log streaming is paused' : 'No logs to display'}
              </Typography>
            </Box>
          ) : (
            <>
              {filteredLogs.map(renderLogEntry)}
              <div ref={logsEndRef} />
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};