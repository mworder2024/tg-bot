import React, { useState, useEffect } from 'react';
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
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tab,
  Tabs,
  Badge,
  Alert,
  Stepper,
  Step,
  StepLabel,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
} from '@mui/material';
import {
  Casino,
  People,
  Timer,
  MonetizationOn,
  CheckCircle,
  Cancel,
  Refresh,
  Visibility,
  Timeline,
  AccountBalanceWallet,
  EmojiEvents,
  Warning,
  PlayArrow,
  Stop,
} from '@mui/icons-material';
import { format } from 'date-fns';

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

interface Player {
  userId: string;
  username: string;
  selectedNumber?: number;
  paymentStatus: 'none' | 'pending' | 'confirmed' | 'failed';
  paymentAmount?: number;
  joinedAt: Date;
  eliminated: boolean;
  eliminationRound?: number;
  isWinner: boolean;
  prizeAmount?: number;
}

interface Game {
  id: string;
  gameId: string;
  state: 'waiting' | 'number_selection' | 'drawing' | 'distributing' | 'finished';
  isPaid: boolean;
  entryFee: number;
  prizePool: number;
  systemFee: number;
  maxPlayers: number;
  currentPlayers: number;
  winnerCount: number;
  numberRange: { min: number; max: number };
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  players: Player[];
  drawHistory: DrawRecord[];
  paymentDeadline?: Date;
  treasuryTx?: string;
  distributionTx?: string;
}

interface DrawRecord {
  round: number;
  drawnNumber: number;
  eliminatedPlayers: string[];
  vrfProof: string;
  timestamp: Date;
}

interface GameStats {
  totalGames: number;
  activeGames: number;
  totalRevenue: number;
  pendingPayments: number;
  failedPayments: number;
  averageGameDuration: number;
}

export const GameMonitor: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    loadGames();
    loadStats();

    // WebSocket for real-time updates
    const ws = new WebSocket('ws://localhost:4000/games');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleGameUpdate(data);
    };

    const interval = setInterval(() => {
      loadGames();
      loadStats();
    }, 10000);

    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, []);

  const loadGames = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/games');
      const data = await response.json();
      if (data.success) {
        setGames(data.games);
      }
    } catch (error) {
      console.error('Failed to load games:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch('/api/v1/games/stats');
      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleGameUpdate = (data: any) => {
    switch (data.type) {
      case 'game_created':
      case 'game_updated':
        setGames(prev => {
          const index = prev.findIndex(g => g.id === data.game.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = data.game;
            return updated;
          }
          return [...prev, data.game];
        });
        break;
      case 'player_joined':
      case 'player_paid':
      case 'player_eliminated':
        setGames(prev => prev.map(game => {
          if (game.id === data.gameId) {
            return { ...game, players: data.players };
          }
          return game;
        }));
        break;
    }
  };

  const openGameDetails = (game: Game) => {
    setSelectedGame(game);
    setDetailsOpen(true);
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'waiting': return 'default';
      case 'number_selection': return 'info';
      case 'drawing': return 'warning';
      case 'distributing': return 'secondary';
      case 'finished': return 'success';
      default: return 'default';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'success';
      case 'pending': return 'warning';
      case 'failed': return 'error';
      default: return 'default';
    }
  };

  const activeGames = games.filter(g => ['waiting', 'number_selection', 'drawing'].includes(g.state));
  const paidGames = games.filter(g => g.isPaid);
  const freeGames = games.filter(g => !g.isPaid);

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          Game Monitor
        </Typography>
        <Box display="flex" gap={1}>
          <Chip
            icon={<Casino />}
            label={`${activeGames.length} Active`}
            color="primary"
          />
          <IconButton onClick={loadGames}>
            <Refresh />
          </IconButton>
        </Box>
      </Box>

      {/* Stats Overview */}
      {stats && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography color="text.secondary" gutterBottom>
                      Total Games
                    </Typography>
                    <Typography variant="h5">
                      {stats.totalGames}
                    </Typography>
                  </Box>
                  <Casino color="primary" />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography color="text.secondary" gutterBottom>
                      Total Revenue
                    </Typography>
                    <Typography variant="h5">
                      {stats.totalRevenue.toFixed(2)} MWOR
                    </Typography>
                  </Box>
                  <MonetizationOn color="success" />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography color="text.secondary" gutterBottom>
                      Pending Payments
                    </Typography>
                    <Typography variant="h5">
                      {stats.pendingPayments}
                    </Typography>
                  </Box>
                  <Timer color="warning" />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography color="text.secondary" gutterBottom>
                      Avg Duration
                    </Typography>
                    <Typography variant="h5">
                      {Math.round(stats.averageGameDuration / 60)}m
                    </Typography>
                  </Box>
                  <Timeline color="info" />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Games Tabs */}
      <Card>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
            <Tab label={`Active (${activeGames.length})`} icon={<PlayArrow />} />
            <Tab label={`Paid Games (${paidGames.length})`} icon={
              <Badge badgeContent={paidGames.filter(g => g.state === 'waiting').length} color="error">
                <MonetizationOn />
              </Badge>
            } />
            <Tab label={`Free Games (${freeGames.length})`} icon={<Casino />} />
            <Tab label="Completed" icon={<CheckCircle />} />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          {/* Active Games */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Game ID</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>State</TableCell>
                  <TableCell>Players</TableCell>
                  <TableCell>Prize Pool</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activeGames.map((game) => (
                  <TableRow key={game.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {game.gameId}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={game.isPaid ? 'Paid' : 'Free'}
                        size="small"
                        color={game.isPaid ? 'secondary' : 'default'}
                        icon={game.isPaid ? <MonetizationOn /> : <Casino />}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={game.state}
                        size="small"
                        color={getStateColor(game.state)}
                      />
                    </TableCell>
                    <TableCell>
                      {game.currentPlayers}/{game.maxPlayers}
                    </TableCell>
                    <TableCell>
                      {game.isPaid ? `${game.prizePool} MWOR` : '—'}
                    </TableCell>
                    <TableCell>
                      {game.startedAt ? format(game.startedAt, 'HH:mm:ss') : '—'}
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => openGameDetails(game)}>
                        <Visibility />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          {/* Paid Games */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Game ID</TableCell>
                  <TableCell>Entry Fee</TableCell>
                  <TableCell>Prize Pool</TableCell>
                  <TableCell>Players</TableCell>
                  <TableCell>Payments</TableCell>
                  <TableCell>State</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paidGames.map((game) => {
                  const confirmedPayments = game.players.filter(p => p.paymentStatus === 'confirmed').length;
                  const pendingPayments = game.players.filter(p => p.paymentStatus === 'pending').length;
                  
                  return (
                    <TableRow key={game.id}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {game.gameId}
                        </Typography>
                      </TableCell>
                      <TableCell>{game.entryFee} MWOR</TableCell>
                      <TableCell>{game.prizePool} MWOR</TableCell>
                      <TableCell>
                        {game.currentPlayers}/{game.maxPlayers}
                      </TableCell>
                      <TableCell>
                        <Box display="flex" gap={0.5}>
                          <Chip
                            label={`${confirmedPayments} paid`}
                            size="small"
                            color="success"
                          />
                          {pendingPayments > 0 && (
                            <Chip
                              label={`${pendingPayments} pending`}
                              size="small"
                              color="warning"
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={game.state}
                          size="small"
                          color={getStateColor(game.state)}
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => openGameDetails(game)}>
                          <Visibility />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>
      </Card>

      {/* Game Details Dialog */}
      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} maxWidth="lg" fullWidth>
        {selectedGame && (
          <>
            <DialogTitle>
              Game Details: {selectedGame.gameId}
              <Chip
                label={selectedGame.state}
                color={getStateColor(selectedGame.state)}
                sx={{ ml: 2 }}
              />
            </DialogTitle>
            <DialogContent>
              <Grid container spacing={3}>
                {/* Game Info */}
                <Grid item xs={12} md={4}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="h6" gutterBottom>
                      Game Information
                    </Typography>
                    <List dense>
                      <ListItem>
                        <ListItemText
                          primary="Type"
                          secondary={selectedGame.isPaid ? 'Paid Game' : 'Free Game'}
                        />
                      </ListItem>
                      {selectedGame.isPaid && (
                        <>
                          <ListItem>
                            <ListItemText
                              primary="Entry Fee"
                              secondary={`${selectedGame.entryFee} MWOR`}
                            />
                          </ListItem>
                          <ListItem>
                            <ListItemText
                              primary="Prize Pool"
                              secondary={`${selectedGame.prizePool} MWOR`}
                            />
                          </ListItem>
                          <ListItem>
                            <ListItemText
                              primary="System Fee (10%)"
                              secondary={`${selectedGame.systemFee} MWOR`}
                            />
                          </ListItem>
                        </>
                      )}
                      <ListItem>
                        <ListItemText
                          primary="Number Range"
                          secondary={`${selectedGame.numberRange.min}-${selectedGame.numberRange.max}`}
                        />
                      </ListItem>
                      <ListItem>
                        <ListItemText
                          primary="Winners"
                          secondary={`${selectedGame.winnerCount} survivor(s)`}
                        />
                      </ListItem>
                    </List>
                  </Paper>
                </Grid>

                {/* Players */}
                <Grid item xs={12} md={8}>
                  <Paper sx={{ p: 2 }}>
                    <Typography variant="h6" gutterBottom>
                      Players ({selectedGame.players.length})
                    </Typography>
                    <TableContainer sx={{ maxHeight: 300 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Username</TableCell>
                            <TableCell>Number</TableCell>
                            {selectedGame.isPaid && <TableCell>Payment</TableCell>}
                            <TableCell>Status</TableCell>
                            <TableCell>Prize</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {selectedGame.players.map((player) => (
                            <TableRow key={player.userId}>
                              <TableCell>{player.username}</TableCell>
                              <TableCell>{player.selectedNumber || '—'}</TableCell>
                              {selectedGame.isPaid && (
                                <TableCell>
                                  <Chip
                                    label={player.paymentStatus}
                                    size="small"
                                    color={getPaymentStatusColor(player.paymentStatus)}
                                  />
                                </TableCell>
                              )}
                              <TableCell>
                                {player.eliminated ? (
                                  <Chip label={`Eliminated R${player.eliminationRound}`} size="small" />
                                ) : player.isWinner ? (
                                  <Chip label="Winner" size="small" color="success" icon={<EmojiEvents />} />
                                ) : (
                                  <Chip label="Active" size="small" color="primary" />
                                )}
                              </TableCell>
                              <TableCell>
                                {player.prizeAmount ? `${player.prizeAmount} MWOR` : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Paper>
                </Grid>

                {/* Draw History */}
                {selectedGame.drawHistory.length > 0 && (
                  <Grid item xs={12}>
                    <Paper sx={{ p: 2 }}>
                      <Typography variant="h6" gutterBottom>
                        Draw History
                      </Typography>
                      <TableContainer sx={{ maxHeight: 200 }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell>Round</TableCell>
                              <TableCell>Number</TableCell>
                              <TableCell>Eliminated</TableCell>
                              <TableCell>VRF Proof</TableCell>
                              <TableCell>Time</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {selectedGame.drawHistory.map((draw) => (
                              <TableRow key={draw.round}>
                                <TableCell>{draw.round}</TableCell>
                                <TableCell>{draw.drawnNumber}</TableCell>
                                <TableCell>{draw.eliminatedPlayers.length}</TableCell>
                                <TableCell>
                                  <Tooltip title={draw.vrfProof}>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                      {draw.vrfProof.slice(0, 8)}...
                                    </Typography>
                                  </Tooltip>
                                </TableCell>
                                <TableCell>{format(draw.timestamp, 'HH:mm:ss')}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Paper>
                  </Grid>
                )}

                {/* Game Progress */}
                {selectedGame.state !== 'finished' && (
                  <Grid item xs={12}>
                    <Paper sx={{ p: 2 }}>
                      <Typography variant="h6" gutterBottom>
                        Game Progress
                      </Typography>
                      <Stepper activeStep={
                        selectedGame.state === 'waiting' ? 0 :
                        selectedGame.state === 'number_selection' ? 1 :
                        selectedGame.state === 'drawing' ? 2 :
                        selectedGame.state === 'distributing' ? 3 : 4
                      }>
                        <Step>
                          <StepLabel>Waiting for Players</StepLabel>
                        </Step>
                        <Step>
                          <StepLabel>Number Selection</StepLabel>
                        </Step>
                        <Step>
                          <StepLabel>Drawing Numbers</StepLabel>
                        </Step>
                        {selectedGame.isPaid && (
                          <Step>
                            <StepLabel>Distributing Prizes</StepLabel>
                          </Step>
                        )}
                        <Step>
                          <StepLabel>Finished</StepLabel>
                        </Step>
                      </Stepper>
                    </Paper>
                  </Grid>
                )}
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetailsOpen(false)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};