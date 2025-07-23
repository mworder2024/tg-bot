import React, { useState, useEffect, useRef } from 'react';
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
} from '@mui/icons-material';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { format } from 'date-fns';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

interface WalletBalance {
  address: string;
  sol: number;
  mwor: number;
  lastUpdated: Date;
}

interface Transaction {
  signature: string;
  slot: number;
  timestamp: Date;
  from: string;
  to: string;
  amount: number;
  token: string;
  status: 'success' | 'failed';
  fee: number;
}

interface NetworkStats {
  slot: number;
  blockHeight: number;
  epochProgress: number;
  tps: number;
  connected: boolean;
}

interface PaymentMonitor {
  paymentId: string;
  expectedAmount: number;
  fromAddress: string;
  status: 'waiting' | 'detected' | 'confirmed' | 'failed';
  detectedAt?: Date;
  confirmedAt?: Date;
  actualAmount?: number;
  signature?: string;
}

export const BlockchainMonitor: React.FC = () => {
  const [tabValue, setTabValue] = useState(0);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activePayments, setActivePayments] = useState<PaymentMonitor[]>([]);
  const [searchAddress, setSearchAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const connectionRef = useRef<Connection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Initialize Solana connection
  useEffect(() => {
    const rpcUrl = process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    connectionRef.current = new Connection(rpcUrl, 'confirmed');

    // Load initial data
    loadNetworkStats();
    loadWalletBalances();

    // Set up intervals
    const statsInterval = setInterval(loadNetworkStats, 5000);
    const walletInterval = setInterval(loadWalletBalances, 30000);

    // Connect to payment monitoring WebSocket
    const ws = new WebSocket('ws://localhost:4000/blockchain');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleBlockchainUpdate(data);
    };
    wsRef.current = ws;

    return () => {
      clearInterval(statsInterval);
      clearInterval(walletInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const loadNetworkStats = async () => {
    if (!connectionRef.current) return;

    try {
      const [slot, blockHeight, epochInfo, perfSamples] = await Promise.all([
        connectionRef.current.getSlot(),
        connectionRef.current.getBlockHeight(),
        connectionRef.current.getEpochInfo(),
        connectionRef.current.getRecentPerformanceSamples(1),
      ]);

      const tps = perfSamples[0]?.numTransactions / perfSamples[0]?.samplePeriodSecs || 0;
      const epochProgress = (epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100;

      setNetworkStats({
        slot,
        blockHeight,
        epochProgress,
        tps: Math.round(tps),
        connected: true,
      });
    } catch (error) {
      console.error('Failed to load network stats:', error);
      setNetworkStats(prev => prev ? { ...prev, connected: false } : null);
    }
  };

  const loadWalletBalances = async () => {
    // Load configured wallets from API
    try {
      const response = await fetch('/api/v1/blockchain/wallets');
      const data = await response.json();
      
      if (data.success && connectionRef.current) {
        const balances = await Promise.all(
          data.wallets.map(async (wallet: any) => {
            const pubkey = new PublicKey(wallet.address);
            const balance = await connectionRef.current!.getBalance(pubkey);
            
            // TODO: Get MWOR balance
            return {
              address: wallet.address,
              sol: balance / LAMPORTS_PER_SOL,
              mwor: wallet.mworBalance || 0,
              lastUpdated: new Date(),
            };
          })
        );
        setWallets(balances);
      }
    } catch (error) {
      console.error('Failed to load wallet balances:', error);
    }
  };

  const handleBlockchainUpdate = (data: any) => {
    switch (data.type) {
      case 'transaction':
        setTransactions(prev => [data.transaction, ...prev.slice(0, 99)]);
        break;
      case 'payment_detected':
        updatePaymentStatus(data.paymentId, 'detected', data);
        break;
      case 'payment_confirmed':
        updatePaymentStatus(data.paymentId, 'confirmed', data);
        break;
      case 'payment_monitor':
        setActivePayments(prev => [...prev, data.monitor]);
        break;
    }
  };

  const updatePaymentStatus = (paymentId: string, status: string, data: any) => {
    setActivePayments(prev => prev.map(payment => {
      if (payment.paymentId === paymentId) {
        return {
          ...payment,
          status: status as any,
          ...(status === 'detected' && {
            detectedAt: new Date(),
            actualAmount: data.amount,
            signature: data.signature,
          }),
          ...(status === 'confirmed' && {
            confirmedAt: new Date(),
          }),
        };
      }
      return payment;
    }));
  };

  const searchTransaction = async () => {
    if (!searchAddress || !connectionRef.current) return;

    setLoading(true);
    try {
      const pubkey = new PublicKey(searchAddress);
      const signatures = await connectionRef.current.getSignaturesForAddress(pubkey, { limit: 20 });
      
      // Process signatures into transactions
      const txs = await Promise.all(
        signatures.map(async (sig) => {
          const tx = await connectionRef.current!.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });
          
          // Extract transaction details
          return {
            signature: sig.signature,
            slot: sig.slot,
            timestamp: new Date((sig.blockTime || 0) * 1000),
            from: searchAddress, // Simplified
            to: 'Various', // Would need to parse transaction
            amount: 0, // Would need to parse transaction
            token: 'SOL',
            status: sig.err ? 'failed' : 'success' as const,
            fee: (tx?.meta?.fee || 0) / LAMPORTS_PER_SOL,
          };
        })
      );
      
      setTransactions(txs);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const openInExplorer = (signature: string) => {
    window.open(`https://explorer.solana.com/tx/${signature}`, '_blank');
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1">
          Blockchain Monitor
        </Typography>
        <Box display="flex" gap={1}>
          <Chip
            icon={<Block />}
            label={networkStats ? `Slot: ${networkStats.slot.toLocaleString()}` : 'Connecting...'}
            color={networkStats?.connected ? 'success' : 'error'}
          />
          <Chip
            icon={<Speed />}
            label={networkStats ? `${networkStats.tps} TPS` : '0 TPS'}
          />
          <IconButton onClick={loadNetworkStats}>
            <Refresh />
          </IconButton>
        </Box>
      </Box>

      {/* Network Overview */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Block Height
                  </Typography>
                  <Typography variant="h5">
                    {networkStats?.blockHeight.toLocaleString() || '—'}
                  </Typography>
                </Box>
                <Block color="primary" />
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
                    Epoch Progress
                  </Typography>
                  <Typography variant="h5">
                    {networkStats ? `${networkStats.epochProgress.toFixed(1)}%` : '—'}
                  </Typography>
                </Box>
                <Timeline color="primary" />
              </Box>
              {networkStats && (
                <LinearProgress
                  variant="determinate"
                  value={networkStats.epochProgress}
                  sx={{ mt: 1 }}
                />
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography color="text.secondary" gutterBottom>
                    Bot Wallet
                  </Typography>
                  <Typography variant="h5">
                    {wallets[0]?.sol.toFixed(4) || '0'} SOL
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {wallets[0]?.mwor.toFixed(2) || '0'} MWOR
                  </Typography>
                </Box>
                <AccountBalance color="primary" />
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
                    Treasury Wallet
                  </Typography>
                  <Typography variant="h5">
                    {wallets[1]?.sol.toFixed(4) || '0'} SOL
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {wallets[1]?.mwor.toFixed(2) || '0'} MWOR
                  </Typography>
                </Box>
                <AccountBalance color="secondary" />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabbed Content */}
      <Card>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
            <Tab label="Payment Monitoring" icon={
              <Badge badgeContent={activePayments.filter(p => p.status === 'waiting').length} color="error">
                <Receipt />
              </Badge>
            } />
            <Tab label="Recent Transactions" icon={<Timeline />} />
            <Tab label="Wallet Balances" icon={<AccountBalance />} />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          {/* Payment Monitoring */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Payment ID</TableCell>
                  <TableCell>Expected Amount</TableCell>
                  <TableCell>From Address</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Detected</TableCell>
                  <TableCell>Confirmed</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activePayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography color="text.secondary">No active payment monitoring</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  activePayments.map((payment) => (
                    <TableRow key={payment.paymentId}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {payment.paymentId.slice(0, 8)}...
                        </Typography>
                      </TableCell>
                      <TableCell>{payment.expectedAmount} MWOR</TableCell>
                      <TableCell>
                        <Tooltip title={payment.fromAddress}>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            {payment.fromAddress.slice(0, 4)}...{payment.fromAddress.slice(-4)}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={payment.status}
                          size="small"
                          color={
                            payment.status === 'confirmed' ? 'success' :
                            payment.status === 'detected' ? 'warning' :
                            payment.status === 'failed' ? 'error' : 'default'
                          }
                          icon={
                            payment.status === 'confirmed' ? <CheckCircle /> :
                            payment.status === 'failed' ? <Cancel /> : undefined
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {payment.detectedAt ? format(payment.detectedAt, 'HH:mm:ss') : '—'}
                      </TableCell>
                      <TableCell>
                        {payment.confirmedAt ? format(payment.confirmedAt, 'HH:mm:ss') : '—'}
                      </TableCell>
                      <TableCell>
                        {payment.signature && (
                          <IconButton size="small" onClick={() => openInExplorer(payment.signature!)}>
                            <OpenInNew fontSize="small" />
                          </IconButton>
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
          {/* Recent Transactions */}
          <Box sx={{ mb: 2 }}>
            <TextField
              fullWidth
              placeholder="Search by address or signature..."
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchTransaction()}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Button onClick={searchTransaction} disabled={loading}>
                      Search
                    </Button>
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          {loading && <LinearProgress />}

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Signature</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell>Amount</TableCell>
                  <TableCell>Token</TableCell>
                  <TableCell>Fee</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.signature}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {tx.signature.slice(0, 8)}...
                      </Typography>
                    </TableCell>
                    <TableCell>{format(tx.timestamp, 'HH:mm:ss')}</TableCell>
                    <TableCell>{tx.amount.toFixed(4)}</TableCell>
                    <TableCell>{tx.token}</TableCell>
                    <TableCell>{tx.fee.toFixed(6)}</TableCell>
                    <TableCell>
                      <Chip
                        label={tx.status}
                        size="small"
                        color={tx.status === 'success' ? 'success' : 'error'}
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => copyToClipboard(tx.signature)}>
                        <ContentCopy fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => openInExplorer(tx.signature)}>
                        <OpenInNew fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          {/* Wallet Balances */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Wallet</TableCell>
                  <TableCell>Address</TableCell>
                  <TableCell align="right">SOL Balance</TableCell>
                  <TableCell align="right">MWOR Balance</TableCell>
                  <TableCell>Last Updated</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {wallets.map((wallet, index) => (
                  <TableRow key={wallet.address}>
                    <TableCell>
                      <Chip
                        label={index === 0 ? 'Bot' : index === 1 ? 'Treasury' : 'Other'}
                        size="small"
                        color={index === 0 ? 'primary' : index === 1 ? 'secondary' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {wallet.address.slice(0, 8)}...{wallet.address.slice(-8)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{wallet.sol.toFixed(4)}</TableCell>
                    <TableCell align="right">{wallet.mwor.toFixed(2)}</TableCell>
                    <TableCell>{format(wallet.lastUpdated, 'HH:mm:ss')}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => copyToClipboard(wallet.address)}>
                        <ContentCopy fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => openInExplorer(wallet.address)}>
                        <OpenInNew fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>
      </Card>
    </Box>
  );
};