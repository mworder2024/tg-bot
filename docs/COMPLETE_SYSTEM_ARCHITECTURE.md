# Complete System Architecture - Solana VRF Lottery PWA

## Executive Summary

This document defines the complete system architecture for a Solana VRF-based lottery Progressive Web Application (PWA) with Telegram/Discord integration. The system features microservices architecture, GraphQL gateway, SIWS authentication, and comprehensive monitoring.

## 1. Microservices Architecture Overview

### 1.1 Service Decomposition

```mermaid
graph TB
    A[GraphQL Gateway] --> B[Authentication Service]
    A --> C[Game Service]
    A --> D[Payment Service]
    A --> E[Notification Service]
    A --> F[Analytics Service]
    A --> G[VRF Oracle Service]
    
    C --> H[FaunaDB]
    D --> I[Solana Program]
    B --> J[Redis Cache]
    F --> K[TimescaleDB]
    E --> L[Message Queue]
```

### 1.2 Core Services

#### A. Authentication Service (Port 3001)
- **Purpose**: SIWS (Sign-In With Solana) authentication
- **Tech Stack**: Node.js, JWT, Redis
- **Responsibilities**:
  - Wallet verification and linking
  - Session management
  - Role-based access control
  - Multi-factor authentication

#### B. Game Service (Port 3002)
- **Purpose**: Game lifecycle management
- **Tech Stack**: Node.js, TypeScript, FaunaDB
- **Responsibilities**:
  - Game creation and state management
  - Player registration and number selection
  - VRF coordination
  - Prize distribution logic

#### C. Payment Service (Port 3003)
- **Purpose**: Blockchain payment processing
- **Tech Stack**: Node.js, Solana Web3.js, Anchor
- **Responsibilities**:
  - Payment verification
  - Transaction monitoring
  - Refund processing
  - Fee calculation and distribution

#### D. Notification Service (Port 3004)
- **Purpose**: Multi-platform messaging
- **Tech Stack**: Node.js, Bull Queue, Redis
- **Responsibilities**:
  - Telegram/Discord message dispatch
  - Email notifications
  - Push notifications for PWA
  - SMS alerts (optional)

#### E. Analytics Service (Port 3005)
- **Purpose**: Data analytics and reporting
- **Tech Stack**: Node.js, TimescaleDB, GraphQL
- **Responsibilities**:
  - Real-time metrics collection
  - Historical data analysis
  - Report generation
  - Performance monitoring

#### F. VRF Oracle Service (Port 3006)
- **Purpose**: Verifiable random number generation
- **Tech Stack**: Rust, Switchboard Oracle
- **Responsibilities**:
  - VRF request coordination
  - Proof verification
  - Result submission to blockchain
  - Backup randomness sources

## 2. GraphQL Gateway Architecture

### 2.1 Gateway Configuration

```typescript
// GraphQL Gateway (Port 3000)
import { ApolloGateway, IntrospectAndCompose } from '@apollo/gateway';
import { ApolloServer } from 'apollo-server-express';

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: 'auth', url: 'http://auth-service:3001/graphql' },
      { name: 'games', url: 'http://game-service:3002/graphql' },
      { name: 'payments', url: 'http://payment-service:3003/graphql' },
      { name: 'notifications', url: 'http://notification-service:3004/graphql' },
      { name: 'analytics', url: 'http://analytics-service:3005/graphql' },
      { name: 'vrf', url: 'http://vrf-service:3006/graphql' }
    ]
  }),
  introspectionHeaders: {
    'Authorization': 'Bearer ${process.env.GATEWAY_TOKEN}'
  }
});
```

### 2.2 Schema Federation

```graphql
# Unified Schema
type User @key(fields: "id") {
  id: ID!
  walletAddress: String!
  telegramId: String
  discordId: String
  games: [Game!]! @provides(fields: "id status")
  payments: [Payment!]!
  analytics: UserAnalytics!
}

type Game @key(fields: "id") {
  id: ID!
  status: GameStatus!
  players: [User!]!
  payments: [Payment!]!
  vrfResults: [VRFResult!]!
  analytics: GameAnalytics!
}

type Payment @key(fields: "id") {
  id: ID!
  user: User!
  game: Game!
  amount: Float!
  transactionHash: String!
  status: PaymentStatus!
}
```

### 2.3 Gateway Features

- **Query Planning**: Optimizes cross-service queries
- **Authentication**: JWT validation at gateway level
- **Rate Limiting**: Service-specific rate limits
- **Caching**: Redis-based query result caching
- **Error Handling**: Unified error response format
- **Monitoring**: Distributed tracing with OpenTelemetry

## 3. Solana Program Architecture

### 3.1 Program Design

```rust
// Core Program Structure
#[program]
pub mod telegram_lottery {
    use super::*;

    // Game lifecycle instructions
    pub fn create_game(ctx: Context<CreateGame>, params: CreateGameParams) -> Result<()>
    pub fn join_game(ctx: Context<JoinGame>, params: JoinGameParams) -> Result<()>
    pub fn submit_vrf(ctx: Context<SubmitVrf>, params: VrfParams) -> Result<()>
    pub fn complete_game(ctx: Context<CompleteGame>, game_id: String) -> Result<()>
    
    // Payment instructions
    pub fn claim_prize(ctx: Context<ClaimPrize>, game_id: String) -> Result<()>
    pub fn request_refund(ctx: Context<RequestRefund>, game_id: String) -> Result<()>
    
    // Admin instructions
    pub fn cancel_game(ctx: Context<CancelGame>, game_id: String) -> Result<()>
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()>
}
```

### 3.2 VRF Integration

```rust
// VRF Account Structure
#[account]
pub struct VrfRequest {
    pub game_id: String,
    pub round: u8,
    pub request_slot: u64,
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub status: VrfStatus,
    pub random_value: Option<[u8; 32]>,
    pub proof: Option<Vec<u8>>,
}

// VRF Verification
impl VrfRequest {
    pub fn verify_proof(&self, proof: &[u8], public_key: &[u8]) -> Result<bool> {
        // Implement VRF proof verification
        // Using ed25519-dalek for cryptographic verification
    }
}
```

### 3.3 Security Features

- **PDA Authority**: All funds held in Program Derived Addresses
- **Multi-signature**: Treasury requires 2-of-3 signatures
- **Timelock**: 24-hour delay on critical operations
- **Emergency Pause**: Circuit breaker for system emergencies
- **Upgrade Authority**: Governed by DAO after initial deployment

## 4. PWA Architecture

### 4.1 Progressive Web App Structure

```typescript
// PWA Configuration
const PWA_CONFIG = {
  name: 'Solana Lottery',
  short_name: 'SolLottery',
  theme_color: '#9945FF',
  background_color: '#14161A',
  display: 'standalone',
  scope: '/',
  start_url: '/',
  icons: [
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png'
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png'
    }
  ]
};
```

### 4.2 Frontend Architecture

```typescript
// React Architecture with Next.js
interface AppState {
  user: UserState;
  wallet: WalletState;
  games: GameState[];
  notifications: NotificationState[];
  theme: ThemeState;
}

// Service Worker for Offline Functionality
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/games')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  }
});
```

### 4.3 Multi-Platform Deployment

- **Web**: Next.js with PWA features
- **Mobile**: Capacitor for iOS/Android
- **Desktop**: Electron wrapper
- **Telegram Mini App**: Embedded web view
- **Discord Activity**: Rich presence integration

## 5. SIWS Authentication Flow

### 5.1 Authentication Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant W as Wallet
    participant A as Auth Service
    participant S as Solana
    
    U->>A: Request authentication
    A->>U: Return challenge message
    U->>W: Sign challenge
    W->>U: Return signature
    U->>A: Submit signature + message
    A->>S: Verify signature on-chain
    S->>A: Confirmation
    A->>U: Return JWT token
```

### 5.2 SIWS Implementation

```typescript
// SIWS Message Format
interface SIWSMessage {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

// Authentication Service
class SIWSAuthService {
  async generateChallenge(address: string): Promise<SIWSMessage> {
    return {
      domain: 'lottery.example.com',
      address,
      statement: 'Sign in to Solana Lottery',
      uri: 'https://lottery.example.com',
      version: '1',
      chainId: 101, // Mainnet
      nonce: generateNonce(),
      issuedAt: new Date().toISOString()
    };
  }

  async verifySignature(message: SIWSMessage, signature: string): Promise<boolean> {
    const messageBytes = new TextEncoder().encode(message.toString());
    const signatureBytes = bs58.decode(signature);
    const publicKey = new PublicKey(message.address);
    
    return nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );
  }
}
```

## 6. Telegram/Discord Integration

### 6.1 Bot Architecture

```typescript
// Multi-Platform Bot Framework
class UnifiedBot {
  private telegramBot: TelegramBot;
  private discordBot: DiscordBot;
  private commandRouter: CommandRouter;

  constructor() {
    this.telegramBot = new TelegramBot(process.env.TELEGRAM_TOKEN);
    this.discordBot = new DiscordBot(process.env.DISCORD_TOKEN);
    this.commandRouter = new CommandRouter();
  }

  async handleMessage(platform: Platform, message: Message): Promise<void> {
    const command = this.commandRouter.parse(message.text);
    const handler = this.commandRouter.getHandler(command.name);
    
    await handler.execute({
      platform,
      user: message.user,
      command,
      respond: (text: string) => this.respond(platform, message, text)
    });
  }
}
```

### 6.2 Command System

```typescript
// Unified Command Interface
interface BotCommand {
  name: string;
  description: string;
  platforms: Platform[];
  permissions: Permission[];
  execute(context: CommandContext): Promise<void>;
}

// Game Commands
class CreateGameCommand implements BotCommand {
  name = 'create';
  description = 'Create a new lottery game';
  platforms = [Platform.TELEGRAM, Platform.DISCORD];
  permissions = [Permission.CREATE_GAME];

  async execute(context: CommandContext): Promise<void> {
    const gameParams = this.parseParams(context.command.args);
    const game = await this.gameService.createGame(gameParams);
    
    await context.respond(`Game created! ID: ${game.id}`);
  }
}
```

### 6.3 Integration Features

- **Cross-Platform Sync**: Games work across Telegram and Discord
- **Rich Embeds**: Game status with buttons and reactions
- **Private Messaging**: Sensitive operations in DMs
- **Group Management**: Auto-moderation and anti-spam
- **Voice Integration**: Discord voice channel notifications

## 7. FaunaDB Schema Design

### 7.1 Database Collections

```javascript
// Users Collection
{
  _id: "users/12345",
  walletAddress: "7xK...9sM",
  telegramId: "telegram_123",
  discordId: "discord_456",
  username: "player1",
  verifiedAt: "2024-01-15T10:30:00Z",
  lastActive: "2024-01-15T15:45:00Z",
  preferences: {
    notifications: true,
    language: "en",
    timezone: "UTC"
  },
  stats: {
    gamesPlayed: 25,
    gamesWon: 3,
    totalWinnings: 150.75,
    totalSpent: 200.00
  }
}

// Games Collection
{
  _id: "games/game_abc123",
  gameId: "game_abc123",
  createdBy: "users/12345",
  type: "paid",
  status: "active",
  params: {
    entryFee: 5.0,
    maxPlayers: 20,
    winnerCount: 1,
    numberRange: { min: 1, max: 50 }
  },
  players: [
    {
      userId: "users/12345",
      number: 42,
      paymentHash: "tx_abc...",
      joinedAt: "2024-01-15T10:30:00Z"
    }
  ],
  rounds: [
    {
      round: 1,
      drawnNumber: 25,
      vrfHash: "vrf_xyz...",
      eliminatedPlayers: ["users/67890"],
      timestamp: "2024-01-15T10:35:00Z"
    }
  ],
  prizeDistribution: {
    totalPool: 95.0,
    systemFee: 5.0,
    winners: [
      {
        userId: "users/12345",
        amount: 95.0,
        claimHash: "claim_def..."
      }
    ]
  },
  createdAt: "2024-01-15T10:00:00Z",
  completedAt: "2024-01-15T10:45:00Z"
}
```

### 7.2 Indexes and Queries

```javascript
// FaunaDB Indexes
CreateIndex({
  name: "games_by_status",
  source: Collection("games"),
  terms: [{ field: ["data", "status"] }]
});

CreateIndex({
  name: "user_games",
  source: Collection("games"),
  terms: [{ field: ["data", "players", "userId"] }]
});

CreateIndex({
  name: "active_players",
  source: Collection("users"),
  terms: [{ field: ["data", "lastActive"] }]
});

// Query Examples
const activeGames = await client.query(
  q.Map(
    q.Paginate(q.Match(q.Index("games_by_status"), "active")),
    q.Lambda("ref", q.Get(q.Var("ref")))
  )
);
```

## 8. Caching and Performance Strategy

### 8.1 Multi-Layer Caching

```typescript
// Cache Architecture
interface CacheLayer {
  level: 'L1' | 'L2' | 'L3';
  storage: 'memory' | 'redis' | 'cdn';
  ttl: number;
  invalidation: 'time' | 'event' | 'manual';
}

const CACHE_CONFIG: Record<string, CacheLayer> = {
  'user:profile': { level: 'L1', storage: 'memory', ttl: 300, invalidation: 'event' },
  'game:state': { level: 'L2', storage: 'redis', ttl: 60, invalidation: 'event' },
  'static:assets': { level: 'L3', storage: 'cdn', ttl: 86400, invalidation: 'manual' }
};
```

### 8.2 Performance Optimizations

- **Connection Pooling**: Database connection pools per service
- **Query Optimization**: FaunaDB query performance monitoring
- **CDN Distribution**: Global edge caching for static assets
- **Compression**: Gzip/Brotli for API responses
- **Image Optimization**: WebP with fallbacks
- **Bundle Splitting**: Dynamic imports for code splitting

## 9. Security Architecture

### 9.1 Defense in Depth

```typescript
// Security Middleware Stack
class SecurityMiddleware {
  static helmet(): Middleware {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "wss:", "https://api.solana.com"]
        }
      },
      hsts: { maxAge: 31536000, includeSubDomains: true }
    });
  }

  static rateLimiter(): Middleware {
    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP'
    });
  }
}
```

### 9.2 Threat Mitigation

- **Input Validation**: Joi/Zod schemas for all inputs
- **SQL Injection**: Parameterized queries only
- **XSS Protection**: Content Security Policy + sanitization
- **CSRF Protection**: Double-submit cookies
- **Rate Limiting**: Per-IP and per-user limits
- **DDoS Protection**: Cloudflare integration
- **Audit Logging**: All security events logged

## 10. Monitoring and Observability

### 10.1 Metrics Collection

```typescript
// Prometheus Metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['route', 'method', 'status_code'],
  buckets: [0.1, 5, 15, 50, 100, 500]
});

const gameEvents = new promClient.Counter({
  name: 'game_events_total',
  help: 'Total number of game events',
  labelNames: ['event_type', 'game_type']
});

const solanaTransactions = new promClient.Counter({
  name: 'solana_transactions_total',
  help: 'Total Solana transactions',
  labelNames: ['type', 'status']
});
```

### 10.2 Distributed Tracing

```typescript
// OpenTelemetry Configuration
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }
    })
  ],
  traceExporter: new JaegerExporter({
    endpoint: 'http://jaeger:14268/api/traces'
  })
});

sdk.start();
```

### 10.3 Health Checks

```typescript
// Service Health Endpoints
app.get('/health', async (req, res) => {
  const checks = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkSolanaRPC(),
    checkFaunaDB()
  ]);

  const healthy = checks.every(check => check.status === 'healthy');
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks: checks.reduce((acc, check) => ({
      ...acc,
      [check.name]: {
        status: check.status,
        responseTime: check.responseTime,
        error: check.error
      }
    }), {})
  });
});
```

## 11. Deployment Architecture

### 11.1 Container Orchestration

```yaml
# docker-compose.production.yml
version: '3.8'
services:
  gateway:
    image: lottery/gateway:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
      - auth-service
      - game-service

  auth-service:
    image: lottery/auth-service:latest
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://auth:password@postgres:5432/auth_db
    depends_on:
      - postgres

  game-service:
    image: lottery/game-service:latest
    ports:
      - "3002:3002"
    environment:
      - FAUNA_SECRET=${FAUNA_SECRET}
    depends_on:
      - redis

  payment-service:
    image: lottery/payment-service:latest
    ports:
      - "3003:3003"
    environment:
      - SOLANA_RPC_URL=${SOLANA_RPC_URL}
      - PROGRAM_ID=${PROGRAM_ID}

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl
```

### 11.2 Infrastructure as Code

```typescript
// Pulumi Infrastructure
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";

const cluster = new aws.eks.Cluster("lottery-cluster", {
  version: "1.28",
  instanceType: "t3.medium",
  desiredCapacity: 3,
  minSize: 1,
  maxSize: 10
});

const namespace = new k8s.core.v1.Namespace("lottery", {
  metadata: { name: "lottery" }
});

const gameService = new k8s.apps.v1.Deployment("game-service", {
  metadata: { namespace: namespace.metadata.name },
  spec: {
    replicas: 3,
    selector: { matchLabels: { app: "game-service" } },
    template: {
      metadata: { labels: { app: "game-service" } },
      spec: {
        containers: [{
          name: "game-service",
          image: "lottery/game-service:latest",
          resources: {
            requests: { cpu: "100m", memory: "256Mi" },
            limits: { cpu: "500m", memory: "512Mi" }
          }
        }]
      }
    }
  }
});
```

## 12. Disaster Recovery

### 12.1 Backup Strategy

```typescript
// Automated Backup System
class BackupService {
  async createSnapshot(): Promise<BackupSnapshot> {
    const timestamp = new Date().toISOString();
    
    const [faunaSnapshot, postgresBackup, redisSnapshot] = await Promise.all([
      this.backupFaunaDB(),
      this.backupPostgreSQL(),
      this.backupRedis()
    ]);

    return {
      id: `backup-${timestamp}`,
      timestamp,
      components: {
        fauna: faunaSnapshot,
        postgres: postgresBackup,
        redis: redisSnapshot
      },
      size: this.calculateSize([faunaSnapshot, postgresBackup, redisSnapshot]),
      status: 'completed'
    };
  }

  async restoreFromBackup(backupId: string): Promise<void> {
    // Implement point-in-time recovery
    const backup = await this.getBackup(backupId);
    
    await Promise.all([
      this.restoreFaunaDB(backup.components.fauna),
      this.restorePostgreSQL(backup.components.postgres),
      this.restoreRedis(backup.components.redis)
    ]);
  }
}
```

### 12.2 Failover Procedures

- **Active-Passive Setup**: Secondary region on standby
- **Health Monitoring**: Automated failover triggers
- **Data Replication**: Real-time cross-region sync
- **DNS Failover**: Route53 health checks
- **Manual Override**: Emergency manual failover procedures

## 13. API Documentation

### 13.1 GraphQL Schema Documentation

```graphql
"""
Create a new lottery game
"""
type Mutation {
  createGame(input: CreateGameInput!): Game!
    @auth(requires: USER)
    @rateLimit(window: "1m", max: 5)
}

"""
Input for creating a game
"""
input CreateGameInput {
  "Entry fee in MWOR tokens"
  entryFee: Float!
  
  "Maximum number of players"
  maxPlayers: Int! @range(min: 2, max: 100)
  
  "Number of winners"
  winnerCount: Int! @range(min: 1, max: 10)
  
  "Game type"
  type: GameType!
}
```

### 13.2 REST API Documentation

```yaml
# OpenAPI 3.0 Specification
openapi: 3.0.0
info:
  title: Solana Lottery API
  version: 1.0.0
  description: Solana VRF-based lottery system API

paths:
  /api/v1/games:
    post:
      summary: Create a new game
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateGameRequest'
      responses:
        '201':
          description: Game created successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Game'
```

## Conclusion

This comprehensive system architecture provides:

1. **Scalability**: Microservices architecture supports horizontal scaling
2. **Security**: Multiple layers of security controls and monitoring
3. **Performance**: Optimized caching and database strategies
4. **Reliability**: Redundancy and disaster recovery procedures
5. **Observability**: Complete monitoring and tracing capabilities
6. **Developer Experience**: Well-documented APIs and development tools

The architecture is designed to handle high-throughput gaming scenarios while maintaining security, transparency, and user experience across multiple platforms.

**Next Steps:**
1. Set up development environment
2. Implement core services in phases
3. Deploy to staging environment
4. Conduct security audit
5. Performance testing and optimization
6. Production deployment with monitoring