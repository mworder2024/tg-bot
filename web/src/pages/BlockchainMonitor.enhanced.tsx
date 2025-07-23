/**
 * Enhanced Blockchain Monitor with integrated blockchain service
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  LinearProgress,
  Alert,
  Button,
  TextField,
  InputAdornment,
  Tab,
  Tabs,
  Badge,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  AccountBalance,
  Speed,
  Block,
  Receipt,
  CheckCircle,
  Cancel,
  Refresh,
  Search,
  ContentCopy,
  OpenInNew,
  Timeline,
  AddCircle,
  SyncAlt,
  Warning,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { useDispatch, useSelector } from 'react-redux';

import { useBlockchainContext } from '../contexts/BlockchainContext';
import {
  selectBlockchainState,
  selectWallet,
  selectPendingTransactions,
  selectNetworkStats,
  fetchWalletBalance,
  fetchGame,
  setActiveGame,
  setGameMonitoring,
} from '../store/slices/blockchainSlice';
import { AppDispatch } from '../store';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export const EnhancedBlockchainMonitor: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const blockchain = useBlockchainContext();
  const blockchainState = useSelector(selectBlockchainState);
  const wallet = useSelector(selectWallet);
  const pendingTransactions = useSelector(selectPendingTransactions);
  const networkStats = useSelector(selectNetworkStats);

  const [tabValue, setTabValue] = useState(0);
  const [searchAddress, setSearchAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [gameSearchId, setGameSearchId] = useState('');
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(blockchain.platform);

  // Auto-refresh wallet balance
  useEffect(() => {
    if (wallet?.address) {
      const interval = setInterval(() => {
        dispatch(fetchWalletBalance(wallet.address));
      }, 30000); // Every 30 seconds

      return () => clearInterval(interval);
    }
  }, [wallet?.address, dispatch]);

  // Monitor active games
  useEffect(() => {
    const monitoredGames = Object.values(blockchainState.games).filter(g => g.isMonitoring);
    
    monitoredGames.forEach(game => {
      blockchain.websocket?.subscribeToGame(game.gameId);
    });

    return () => {
      monitoredGames.forEach(game => {
        blockchain.websocket?.unsubscribeFromGame(game.gameId);
      });
    };
  }, [blockchainState.games, blockchain.websocket]);

  const handleConnect = async () => {
    setShowConnectDialog(false);
    await blockchain.connect();
  };

  const handleDisconnect = () => {
    blockchain.disconnect();
  };

  const handleSearchGame = async () => {
    if (!gameSearchId) return;

    setLoading(true);
    try {
      await dispatch(fetchGame(gameSearchId)).unwrap();
      dispatch(setActiveGame(gameSearchId));
      dispatch(setGameMonitoring({ gameId: gameSearchId, monitoring: true }));
    } catch (error) {
      console.error('Failed to fetch game:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshBalance = () => {
    if (wallet?.address) {
      dispatch(fetchWalletBalance(wallet.address));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const openInExplorer = (signature: string) => {
    const network = process.env.REACT_APP_SOLANA_NETWORK || 'mainnet-beta';
    window.open(`https://explorer.solana.com/tx/${signature}?cluster=${network}`, '_blank');
  };

  const formatTransactionType = (type: string): string => {
    return type.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          Enhanced Blockchain Monitor
        </Typography>
        <Box display="flex" gap={1} alignItems="center">
          {/* Connection Status */}
          <Chip
            icon={<SyncAlt />}
            label={blockchain.connected ? 'Connected' : 'Disconnected'}
            color={blockchain.connected ? 'success' : 'error'}
            onClick={() => !blockchain.connected && setShowConnectDialog(true)}
          />
          
          {/* Network Stats */}
          <Chip
            icon={<Block />}
            label={networkStats ? `Slot: ${networkStats.slot.toLocaleString()}` : 'Loading...'}
            color={networkStats?.connected ? 'success' : 'default'}
          />
          <Chip
            icon={<Speed />}
            label={networkStats ? `${networkStats.tps} TPS` : '0 TPS'}
          />
          
          {/* WebSocket Status */}
          {blockchainState.wsConnected && (
            <Chip
              icon={<CheckCircle />}
              label="Live Updates"
              color="success"
              size="small"
            />
          )}
          
          <IconButton onClick={handleRefreshBalance}>
            <Refresh />
          </IconButton>
        </Box>
      </Box>

      {/* Wallet Overview */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Connected Wallet
                  </Typography>
                  {wallet ? (
                    <>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {wallet.address.slice(0, 8)}...{wallet.address.slice(-8)}
                      </Typography>
                      <Typography variant="h6">
                        {wallet.balance.sol.toFixed(4)} SOL
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {wallet.balance.mwor.toFixed(2)} MWOR
                      </Typography>
                    </>
                  ) : (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => setShowConnectDialog(true)}
                      startIcon={<AccountBalance />}
                    >
                      Connect Wallet
                    </Button>
                  )}
                </Box>
                <AccountBalance color="primary" />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Pending Transactions
                  </Typography>
                  <Typography variant="h3">
                    {pendingTransactions.length}
                  </Typography>
                  {pendingTransactions.length > 0 && (
                    <LinearProgress sx={{ mt: 1 }} />
                  )}
                </Box>
                <Receipt color="primary" />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Active Games
                  </Typography>
                  <Typography variant="h3">
                    {Object.keys(blockchainState.games).length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {Object.values(blockchainState.games).filter(g => g.isMonitoring).length} monitoring
                  </Typography>
                </Box>
                <Timeline color="primary" />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabbed Content */}
      <Card>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
            <Tab 
              label="Transactions" 
              icon={
                <Badge badgeContent={pendingTransactions.length} color="error">
                  <Receipt />
                </Badge>
              } 
            />
            <Tab label="Games" icon={<Timeline />} />
            <Tab label="Network Stats" icon={<Block />} />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          {/* Transactions Tab */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Signature</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Game ID</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Confirmations</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.values(blockchainState.transactions).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography color="text.secondary">No transactions yet</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  Object.values(blockchainState.transactions)
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .map((tx) => (
                      <TableRow key={tx.signature}>
                        <TableCell>{formatTransactionType(tx.type)}</TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {tx.signature ? `${tx.signature.slice(0, 8)}...` : 'Pending'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={tx.status}
                            size="small"
                            color={
                              tx.status === 'confirmed' ? 'success' :
                              tx.status === 'failed' ? 'error' :
                              tx.status === 'processing' ? 'warning' : 'default'
                            }
                            icon={
                              tx.status === 'confirmed' ? <CheckCircle /> :
                              tx.status === 'failed' ? <Cancel /> : undefined
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {tx.gameId && (
                            <Chip
                              label={tx.gameId.slice(0, 8)}
                              size="small"
                              onClick={() => {
                                setGameSearchId(tx.gameId!);
                                setTabValue(1);
                              }}
                            />
                          )}
                        </TableCell>
                        <TableCell>{format(new Date(tx.timestamp), 'HH:mm:ss')}</TableCell>
                        <TableCell>{tx.confirmations || '—'}</TableCell>
                        <TableCell>
                          {tx.signature && (
                            <>
                              <IconButton size="small" onClick={() => copyToClipboard(tx.signature)}>
                                <ContentCopy fontSize="small" />
                              </IconButton>
                              <IconButton size="small" onClick={() => openInExplorer(tx.signature)}>
                                <OpenInNew fontSize="small" />
                              </IconButton>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          {/* Games Tab */}
          <Box sx={{ mb: 2 }}>
            <TextField
              fullWidth
              placeholder="Search game by ID..."
              value={gameSearchId}
              onChange={(e) => setGameSearchId(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearchGame()}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Button onClick={handleSearchGame} disabled={loading}>
                      Search
                    </Button>
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          {loading && <LinearProgress />}

          {Object.values(blockchainState.games).length === 0 ? (
            <Alert severity="info">
              No games loaded. Search for a game ID to start monitoring.
            </Alert>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Game ID</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Players</TableCell>
                    <TableCell>Entry Fee</TableCell>
                    <TableCell>Prize Pool</TableCell>
                    <TableCell>Monitoring</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.values(blockchainState.games).map((game) => (
                    <TableRow key={game.gameId}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {game.gameId.slice(0, 12)}...
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={game.state.status}
                          size="small"
                          color={
                            game.state.status === 'active' ? 'success' :
                            game.state.status === 'completed' ? 'primary' :
                            'default'
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {game.players.length} / {game.state.maxPlayers}
                      </TableCell>
                      <TableCell>{(Number(game.state.entryFee) / 1e6).toFixed(2)} MWOR</TableCell>
                      <TableCell>
                        {((Number(game.state.entryFee) / 1e6) * game.players.length).toFixed(2)} MWOR
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={game.isMonitoring ? 'Active' : 'Inactive'}
                          size="small"
                          color={game.isMonitoring ? 'success' : 'default'}
                          onClick={() => dispatch(setGameMonitoring({
                            gameId: game.gameId,
                            monitoring: !game.isMonitoring
                          }))}
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => dispatch(fetchGame(game.gameId))}
                        >
                          <Refresh fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          {/* Network Stats Tab */}
          {networkStats ? (
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Network Information
                    </Typography>
                    <Box sx={{ '& > div': { mb: 1 } }}>
                      <Box display="flex" justifyContent="space-between">
                        <Typography color="text.secondary">Current Slot</Typography>
                        <Typography>{networkStats.slot.toLocaleString()}</Typography>
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography color="text.secondary">Block Height</Typography>
                        <Typography>{networkStats.blockHeight.toLocaleString()}</Typography>
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography color="text.secondary">TPS</Typography>
                        <Typography>{networkStats.tps}</Typography>
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography color="text.secondary">Epoch Progress</Typography>
                        <Typography>{networkStats.epochProgress.toFixed(1)}%</Typography>
                      </Box>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={networkStats.epochProgress}
                      sx={{ mt: 2 }}
                    />
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Connection Status
                    </Typography>
                    <Box sx={{ '& > div': { mb: 1 } }}>
                      <Box display="flex" justifyContent="space-between">
                        <Typography color="text.secondary">RPC Connection</Typography>
                        <Chip
                          label={networkStats.connected ? 'Connected' : 'Disconnected'}
                          size="small"
                          color={networkStats.connected ? 'success' : 'error'}
                        />
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography color="text.secondary">WebSocket</Typography>
                        <Chip
                          label={blockchainState.wsConnected ? 'Connected' : 'Disconnected'}
                          size="small"
                          color={blockchainState.wsConnected ? 'success' : 'error'}
                        />
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography color="text.secondary">Platform</Typography>
                        <Chip label={blockchain.platform} size="small" />
                      </Box>
                      <Box display="flex" justifyContent="space-between">
                        <Typography color="text.secondary">Last Updated</Typography>
                        <Typography variant="body2">
                          {format(new Date(networkStats.lastUpdated), 'HH:mm:ss')}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          ) : (
            <Alert severity="info">
              Waiting for network statistics...
            </Alert>
          )}
        </TabPanel>
      </Card>

      {/* Connect Wallet Dialog */}
      <Dialog open={showConnectDialog} onClose={() => setShowConnectDialog(false)}>
        <DialogTitle>Connect Wallet</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Platform</InputLabel>
            <Select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value as Platform)}
              label="Platform"
            >
              <MenuItem value="web">Web (Browser Wallet)</MenuItem>
              <MenuItem value="telegram">Telegram (Server Wallet)</MenuItem>
              <MenuItem value="discord">Discord (Bot Wallet)</MenuItem>
              <MenuItem value="mobile">Mobile (Deep Link)</MenuItem>
            </Select>
          </FormControl>
          {selectedPlatform === 'telegram' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Telegram wallets are managed server-side. Make sure you're logged in.
            </Alert>
          )}
          {selectedPlatform === 'discord' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Discord wallets require approval through Discord DM.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowConnectDialog(false)}>Cancel</Button>
          <Button onClick={handleConnect} variant="contained">
            Connect
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};