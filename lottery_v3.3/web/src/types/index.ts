// User and Authentication Types
export interface User {
  id: string;
  username: string;
  email?: string;
  role: UserRole;
  permissions?: string[];
  createdAt?: string;
  lastLoginAt?: string;
}

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
  VIEWER = 'viewer'
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

// Game Types
export interface Game {
  id: string;
  gameId: string;
  startTime: string;
  endTime?: string;
  playerCount: number;
  maxNumber: number;
  durationSeconds?: number;
  isPaid: boolean;
  entryFee?: number;
  prizePool?: number;
  systemFee?: number;
  winnersCount: number;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
}

export enum GameStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

// Player Types
export interface Player {
  id: string;
  userId: string;
  username: string;
  gamesPlayed: number;
  gamesWon: number;
  totalSpent: number;
  totalWon: number;
  lastActive: string;
  walletAddress?: string;
  walletVerified: boolean;
  winRate?: number;
  netProfit?: number;
  rank?: number;
}

// Transaction Types
export interface Transaction {
  id: string;
  transactionType: TransactionType;
  userId?: string;
  gameId?: string;
  paymentId?: string;
  amount: number;
  token: string;
  status: TransactionStatus;
  blockchainHash?: string;
  fromAddress?: string;
  toAddress?: string;
  errorMessage?: string;
  metadata?: any;
  createdAt: string;
  confirmedAt?: string;
}

export enum TransactionType {
  PAYMENT = 'payment',
  REFUND = 'refund',
  PRIZE_DISTRIBUTION = 'prize_distribution'
}

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  REFUNDED = 'refunded'
}

// Metrics Types
export interface RealtimeMetrics {
  timestamp: string;
  games: {
    active: number;
    pending: number;
    total24h: number;
  };
  players: {
    online: number;
    active: number;
    total24h: number;
  };
  payments: {
    processing: number;
    confirmed24h: number;
    failed24h: number;
    volume24h: number;
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    uptime: number;
    errorRate: number;
  };
}

// Analytics Types
export interface GameAnalytics {
  period: string;
  totalGames: number;
  completedGames: number;
  cancelledGames: number;
  avgPlayers: number;
  avgDuration: number;
  totalPrizePool: number;
  totalSystemFee: number;
}

export interface RevenueAnalytics {
  period: string;
  uniqueGames: number;
  uniquePayers: number;
  totalTransactions: number;
  successfulPayments: number;
  failedPayments: number;
  refundedPayments: number;
  grossRevenue: number;
  totalRefunds: number;
  netRevenue: number;
}

// System Types
export interface SystemEvent {
  id: string;
  eventType: string;
  severity: EventSeverity;
  component?: string;
  message: string;
  details?: any;
  errorStack?: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

export enum EventSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface Alert {
  id: string;
  name: string;
  metricName: string;
  condition: string;
  threshold: number;
  timeWindowMinutes: number;
  notificationChannels?: any;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Configuration Types
export interface Configuration {
  key: string;
  value: any;
  description?: string;
  category?: string;
  isSensitive: boolean;
  updatedBy?: string;
  updatedAt: string;
}

// Audit Log Types
export interface AuditLog {
  id: string;
  action: string;
  actorId: string;
  actorUsername?: string;
  actorIp?: string;
  targetType?: string;
  targetId?: string;
  oldValue?: any;
  newValue?: any;
  metadata?: any;
  createdAt: string;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    details?: any;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// WebSocket Event Types
export interface MetricsUpdateEvent {
  metrics: RealtimeMetrics;
}

export interface GameCancelledEvent {
  gameId: string;
  reason: string;
  cancelledBy: string;
}

export interface ConfigUpdatedEvent {
  key: string;
  value: any;
  updatedBy: string;
  timestamp: string;
}

export interface SystemMaintenanceEvent {
  enabled: boolean;
  message?: string;
}

// Chart Data Types
export interface ChartDataPoint {
  x: string | number | Date;
  y: number;
}

export interface ChartSeries {
  name: string;
  data: ChartDataPoint[];
  color?: string;
}

// Form Types
export interface LoginForm {
  username: string;
  password: string;
}

export interface CreateGameForm {
  maxPlayers: number;
  startMinutes: number;
  survivors: number;
  selectionMultiplier: number;
  isPaid: boolean;
  entryFee?: number;
}

export interface RefundForm {
  reason: string;
  amount?: number;
}

export interface ConfigUpdateForm {
  value: any;
  description?: string;
}

// Filter Types
export interface DateRangeFilter {
  from?: Date;
  to?: Date;
}

export interface GameFilter extends DateRangeFilter {
  status?: GameStatus;
  isPaid?: boolean;
}

export interface TransactionFilter extends DateRangeFilter {
  userId?: string;
  gameId?: string;
  status?: TransactionStatus;
  type?: TransactionType;
}

// Dashboard State Types
export interface DashboardState {
  metrics: RealtimeMetrics | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
}

export interface NotificationState {
  open: boolean;
  message: string;
  severity: 'success' | 'error' | 'warning' | 'info';
}