/**
 * Performance Monitoring Dashboard Component
 * Displays real-time performance metrics and optimization recommendations
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  LinearProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Speed as SpeedIcon,
  Memory as MemoryIcon,
  Cloud as NetworkIcon,
  Storage as CacheIcon,
  TrendingUp as TrendingUpIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useComponentPerformance, useNetworkStatus } from '../../hooks/usePerformance';
import performanceIntegration from '../../performance-integration';

interface PerformanceMetrics {
  graphql: {
    queryCount: number;
    cacheHits: number;
    cacheMisses: number;
    averageResponseTime: number;
  };
  blockchain: {
    connectionPoolSize: number;
    healthyEndpoints: number;
    totalEndpoints: number;
    queueSize: number;
  };
  network: {
    totalRequests: number;
    cachedRequests: number;
    failedRequests: number;
    averageLatency: number;
    bandwidthSaved: number;
  };
  memory: {
    totalAllocated: number;
    componentsInMemory: number;
    cacheSize: number;
    leaksDetected: number;
    formattedCacheSize: string;
    formattedTotal: string;
  };
  webVitals: {
    score: number;
    grade: string;
  };
  recommendations: string[];
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role=\"tabpanel\"
      hidden={value !== index}
      id={`performance-tabpanel-${index}`}
      aria-labelledby={`performance-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const PerformanceDashboard: React.FC = () => {
  const { renderCount } = useComponentPerformance('PerformanceDashboard');
  const networkStatus = useNetworkStatus();
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);

  // Fetch metrics
  const fetchMetrics = async () => {
    try {
      const data = performanceIntegration.getMetrics();
      setMetrics(data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch performance metrics:', error);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    
    if (autoRefresh) {
      const interval = setInterval(fetchMetrics, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const getStatusColor = (value: number, good: number, warning: number) => {
    if (value >= good) return 'success';
    if (value >= warning) return 'warning';
    return 'error';
  };

  const formatBytes = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Typography variant=\"h6\">Loading Performance Metrics...</Typography>
          <LinearProgress sx={{ mt: 2 }} />
        </CardContent>
      </Card>
    );
  }

  if (!metrics) {
    return (
      <Card>
        <CardContent>
          <Alert severity=\"error\">
            Failed to load performance metrics
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const cacheHitRate = metrics.graphql.queryCount > 0 
    ? (metrics.graphql.cacheHits / metrics.graphql.queryCount) * 100 
    : 0;

  const networkSuccessRate = metrics.network.totalRequests > 0 
    ? ((metrics.network.totalRequests - metrics.network.failedRequests) / metrics.network.totalRequests) * 100 
    : 0;

  const blockchainHealthRate = metrics.blockchain.totalEndpoints > 0 
    ? (metrics.blockchain.healthyEndpoints / metrics.blockchain.totalEndpoints) * 100 
    : 0;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant=\"h5\">Performance Dashboard</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
              }
              label=\"Auto Refresh\"
            />
            <Chip
              label={`Network: ${networkStatus.effectiveType.toUpperCase()}`}
              color={networkStatus.online ? 'success' : 'error'}
              size=\"small\"
            />
            <Chip
              label={`Renders: ${renderCount}`}
              color=\"info\"
              size=\"small\"
            />
          </Box>
        </Box>

        {/* Web Vitals Score */}
        <Alert 
          severity={metrics.webVitals.score >= 80 ? 'success' : metrics.webVitals.score >= 60 ? 'warning' : 'error'}
          sx={{ mb: 2 }}
        >
          <Typography variant=\"h6\">
            Web Vitals Score: {metrics.webVitals.score}/100 (Grade: {metrics.webVitals.grade})
          </Typography>
        </Alert>

        {/* Performance Recommendations */}
        {metrics.recommendations.length > 0 && (
          <Alert severity=\"warning\" sx={{ mb: 2 }}>
            <Typography variant=\"subtitle1\" gutterBottom>
              Performance Recommendations:
            </Typography>
            <List dense>
              {metrics.recommendations.map((recommendation, index) => (
                <ListItem key={index} disablePadding>
                  <ListItemIcon>
                    <WarningIcon color=\"warning\" />
                  </ListItemIcon>
                  <ListItemText primary={recommendation} />
                </ListItem>
              ))}
            </List>
          </Alert>
        )}

        {/* Metrics Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label=\"performance metrics tabs\">
            <Tab label=\"Overview\" icon={<SpeedIcon />} />
            <Tab label=\"GraphQL\" icon={<TrendingUpIcon />} />
            <Tab label=\"Blockchain\" icon={<NetworkIcon />} />
            <Tab label=\"Network\" icon={<NetworkIcon />} />
            <Tab label=\"Memory\" icon={<MemoryIcon />} />
          </Tabs>
        </Box>

        {/* Overview Tab */}
        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6} md={3}>
              <Card variant=\"outlined\">
                <CardContent>
                  <Typography color=\"textSecondary\" gutterBottom>
                    GraphQL Cache Hit Rate
                  </Typography>
                  <Typography variant=\"h4\" color={getStatusColor(cacheHitRate, 80, 60)}>
                    {cacheHitRate.toFixed(1)}%
                  </Typography>
                  <LinearProgress
                    variant=\"determinate\"
                    value={cacheHitRate}
                    color={getStatusColor(cacheHitRate, 80, 60)}
                    sx={{ mt: 1 }}
                  />
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card variant=\"outlined\">
                <CardContent>
                  <Typography color=\"textSecondary\" gutterBottom>
                    Network Success Rate
                  </Typography>
                  <Typography variant=\"h4\" color={getStatusColor(networkSuccessRate, 95, 90)}>
                    {networkSuccessRate.toFixed(1)}%
                  </Typography>
                  <LinearProgress
                    variant=\"determinate\"
                    value={networkSuccessRate}
                    color={getStatusColor(networkSuccessRate, 95, 90)}
                    sx={{ mt: 1 }}
                  />
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card variant=\"outlined\">
                <CardContent>
                  <Typography color=\"textSecondary\" gutterBottom>
                    Blockchain Health
                  </Typography>
                  <Typography variant=\"h4\" color={getStatusColor(blockchainHealthRate, 80, 60)}>
                    {blockchainHealthRate.toFixed(1)}%
                  </Typography>
                  <LinearProgress
                    variant=\"determinate\"
                    value={blockchainHealthRate}
                    color={getStatusColor(blockchainHealthRate, 80, 60)}
                    sx={{ mt: 1 }}
                  />
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <Card variant=\"outlined\">
                <CardContent>
                  <Typography color=\"textSecondary\" gutterBottom>
                    Memory Usage
                  </Typography>
                  <Typography variant=\"h4\">
                    {metrics.memory.formattedTotal}
                  </Typography>
                  <Typography variant=\"body2\" color=\"textSecondary\">
                    Cache: {metrics.memory.formattedCacheSize}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </TabPanel>

        {/* GraphQL Tab */}
        <TabPanel value={tabValue} index={1}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant=\"h6\" gutterBottom>Query Performance</Typography>
              <List>
                <ListItem>
                  <ListItemText
                    primary=\"Total Queries\"
                    secondary={metrics.graphql.queryCount.toLocaleString()}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Cache Hits\"
                    secondary={`${metrics.graphql.cacheHits.toLocaleString()} (${cacheHitRate.toFixed(1)}%)`}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Cache Misses\"
                    secondary={metrics.graphql.cacheMisses.toLocaleString()}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Average Response Time\"
                    secondary={`${metrics.graphql.averageResponseTime.toFixed(0)}ms`}
                  />
                </ListItem>
              </List>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Blockchain Tab */}
        <TabPanel value={tabValue} index={2}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant=\"h6\" gutterBottom>Connection Pool</Typography>
              <List>
                <ListItem>
                  <ListItemText
                    primary=\"Pool Size\"
                    secondary={`${metrics.blockchain.connectionPoolSize} connections`}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Healthy Endpoints\"
                    secondary={`${metrics.blockchain.healthyEndpoints}/${metrics.blockchain.totalEndpoints}`}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Queue Size\"
                    secondary={`${metrics.blockchain.queueSize} pending transactions`}
                  />
                </ListItem>
              </List>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Network Tab */}
        <TabPanel value={tabValue} index={3}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant=\"h6\" gutterBottom>Network Statistics</Typography>
              <List>
                <ListItem>
                  <ListItemText
                    primary=\"Total Requests\"
                    secondary={metrics.network.totalRequests.toLocaleString()}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Cached Requests\"
                    secondary={`${metrics.network.cachedRequests.toLocaleString()} (${((metrics.network.cachedRequests / metrics.network.totalRequests) * 100).toFixed(1)}%)`}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Failed Requests\"
                    secondary={metrics.network.failedRequests.toLocaleString()}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Average Latency\"
                    secondary={`${metrics.network.averageLatency.toFixed(0)}ms`}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Bandwidth Saved\"
                    secondary={formatBytes(metrics.network.bandwidthSaved)}
                  />
                </ListItem>
              </List>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Memory Tab */}
        <TabPanel value={tabValue} index={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant=\"h6\" gutterBottom>Memory Usage</Typography>
              <List>
                <ListItem>
                  <ListItemText
                    primary=\"Total Allocated\"
                    secondary={metrics.memory.formattedTotal}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Components in Memory\"
                    secondary={metrics.memory.componentsInMemory.toLocaleString()}
                  />
                </ListItem>
                <ListItem>
                  <ListItemText
                    primary=\"Cache Size\"
                    secondary={metrics.memory.formattedCacheSize}
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    {metrics.memory.leaksDetected > 0 ? 
                      <ErrorIcon color=\"error\" /> : 
                      <CheckCircleIcon color=\"success\" />
                    }
                  </ListItemIcon>
                  <ListItemText
                    primary=\"Memory Leaks\"
                    secondary={`${metrics.memory.leaksDetected} detected`}
                  />
                </ListItem>
              </List>
            </Grid>
          </Grid>
        </TabPanel>
      </CardContent>
    </Card>
  );
};

export default PerformanceDashboard;