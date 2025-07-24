# Multi-Lottery Architecture Design

## Overview

This document outlines the architecture for supporting multiple concurrent lottery games with different configurations, rules, and prize pools while maintaining performance and scalability.

## Core Requirements

### Functional Requirements
1. Support unlimited concurrent lottery games
2. Each lottery can have unique:
   - Entry fees and prize structures
   - Game rules and number ranges
   - Draw schedules and frequencies
   - Player limits and restrictions
   - Currency support (SOL, USDC, custom tokens)
3. Cross-lottery features:
   - Combined leaderboards
   - Multi-game packages/bundles
   - Loyalty rewards across games
   - Unified wallet management

### Non-Functional Requirements
1. Sub-second response times
2. Support 10,000+ concurrent players
3. 99.9% uptime
4. Real-time updates across all games
5. Horizontal scalability

## Architecture Design

### 1. Database Schema (PostgreSQL)

```sql
-- Multi-tenant lottery schema with partitioning
CREATE TABLE lottery_games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'classic', 'instant', 'progressive'
    status VARCHAR(20) NOT NULL, -- 'active', 'pending', 'completed'
    config JSONB NOT NULL, -- Game-specific configuration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
) PARTITION BY LIST (status);

-- Partition by lottery_id for scalability
CREATE TABLE game_entries (
    id UUID DEFAULT gen_random_uuid(),
    lottery_id UUID NOT NULL,
    player_id VARCHAR(255) NOT NULL,
    numbers INTEGER[] NOT NULL,
    tx_signature VARCHAR(255),
    entry_fee DECIMAL(20, 9),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (id, lottery_id)
) PARTITION BY HASH (lottery_id);

-- Time-series data for analytics
CREATE TABLE game_events (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    lottery_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    player_id VARCHAR(255),
    data JSONB,
    PRIMARY KEY (time, lottery_id)
) PARTITION BY RANGE (time);
```

### 2. Service Architecture

```yaml
# Microservices for multi-lottery support
services:
  lottery-manager:
    # Manages lottery lifecycle
    responsibilities:
      - Create/update lottery configurations
      - Schedule draws
      - Manage game states
    
  game-engine:
    # Handles game logic per lottery type
    instances: 5 # Scale based on game types
    responsibilities:
      - Process entries
      - Validate rules
      - Calculate winners
    
  entry-processor:
    # High-throughput entry handling
    instances: 10 # Scale based on load
    responsibilities:
      - Validate payments
      - Record entries
      - Update statistics
    
  draw-coordinator:
    # Manages VRF and draws
    responsibilities:
      - Schedule VRF requests
      - Process draw results
      - Distribute prizes
```

### 3. Caching Strategy (Redis)

```typescript
// Hierarchical caching for multi-lottery
interface CacheStructure {
  // Global cache keys
  'lotteries:active': LotteryInfo[];
  'lotteries:featured': LotteryInfo[];
  
  // Per-lottery cache keys
  'lottery:{id}:info': LotteryDetails;
  'lottery:{id}:entries:count': number;
  'lottery:{id}:prize:pool': bigint;
  'lottery:{id}:leaderboard': LeaderboardEntry[];
  
  // Player-specific cache
  'player:{id}:lotteries': string[]; // Active lottery IDs
  'player:{id}:lottery:{lid}:entries': Entry[];
}

// Cache invalidation strategy
const cacheConfig = {
  'lotteries:active': { ttl: 300 }, // 5 minutes
  'lottery:*:info': { ttl: 60 }, // 1 minute
  'lottery:*:entries:count': { ttl: 10 }, // 10 seconds
  'lottery:*:prize:pool': { ttl: 5 }, // 5 seconds
};
```

### 4. Real-time Updates Architecture

```typescript
// Socket.io namespace structure for multi-lottery
interface SocketNamespaces {
  '/global': {
    // Global events across all lotteries
    events: {
      'lottery:created': (lottery: LotteryInfo) => void;
      'lottery:completed': (lotteryId: string, winners: Winner[]) => void;
      'stats:update': (stats: GlobalStats) => void;
    };
  };
  
  '/lottery/{id}': {
    // Per-lottery namespace for focused updates
    events: {
      'entry:new': (entry: Entry) => void;
      'prize:update': (amount: bigint) => void;
      'draw:countdown': (seconds: number) => void;
      'draw:result': (result: DrawResult) => void;
    };
  };
}

// Redis Pub/Sub for cross-server communication
const pubsubChannels = {
  'lottery:*:entries': 'Broadcast new entries',
  'lottery:*:draw': 'Coordinate draw events',
  'system:scale': 'Auto-scaling triggers',
};
```

### 5. Solana Program Modifications

```rust
// Multi-lottery Solana program structure
pub mod lottery_v4 {
    use anchor_lang::prelude::*;
    
    #[account]
    pub struct LotteryRegistry {
        pub authority: Pubkey,
        pub lottery_count: u64,
        pub total_volume: u64,
    }
    
    #[account]
    pub struct Lottery {
        pub id: [u8; 16],
        pub config: LotteryConfig,
        pub state: LotteryState,
        pub prize_pool: u64,
        pub entry_count: u32,
        pub winner_count: u8,
    }
    
    #[derive(AnchorSerialize, AnchorDeserialize)]
    pub struct LotteryConfig {
        pub entry_fee: u64,
        pub max_entries: u32,
        pub number_range: (u8, u8),
        pub prize_distribution: Vec<u8>, // Percentage for each winner
        pub draw_frequency: i64, // Seconds between draws
        pub vrf_config: VrfConfig,
    }
}
```

### 6. API Gateway Pattern

```typescript
// GraphQL Federation for multi-lottery API
const typeDefs = gql`
  type Query {
    # Lottery discovery
    lotteries(
      filter: LotteryFilter
      sort: LotterySort
      pagination: Pagination
    ): LotteryConnection!
    
    # Specific lottery
    lottery(id: ID!): Lottery
    
    # Player's lotteries
    myLotteries(
      status: LotteryStatus
    ): [Lottery!]!
  }
  
  type Mutation {
    # Lottery management
    createLottery(input: CreateLotteryInput!): Lottery!
    
    # Entry management
    enterLottery(
      lotteryId: ID!
      numbers: [Int!]!
      paymentSignature: String!
    ): Entry!
    
    # Batch operations
    enterMultipleLotteries(
      entries: [LotteryEntryInput!]!
    ): [Entry!]!
  }
  
  type Subscription {
    # Global subscriptions
    lotteryUpdates: LotteryUpdate!
    
    # Lottery-specific subscriptions
    lotteryEvents(lotteryId: ID!): LotteryEvent!
    
    # Player-specific subscriptions
    myLotteryEvents: PlayerLotteryEvent!
  }
`;
```

### 7. Load Distribution Strategy

```yaml
# HAProxy configuration for multi-lottery load balancing
global:
  maxconn 100000
  
defaults:
  timeout connect 5s
  timeout client 30s
  timeout server 30s
  
frontend lottery_frontend:
  bind *:443 ssl crt /etc/ssl/lottery.pem
  
  # Route by lottery ID for sticky sessions
  acl is_lottery_specific path_beg /api/lottery/
  use_backend lottery_sharded if is_lottery_specific
  
  default_backend lottery_general
  
backend lottery_sharded:
  # Shard by lottery ID
  balance source
  hash-type consistent
  
  server shard1 lottery1:3000 check
  server shard2 lottery2:3000 check
  server shard3 lottery3:3000 check
  
backend lottery_general:
  # General queries use round-robin
  balance roundrobin
  
  server general1 lottery1:3000 check
  server general2 lottery2:3000 check
```

### 8. Performance Optimizations

```typescript
// Query optimization for multi-lottery
class LotteryQueryOptimizer {
  // Materialized view for active lotteries
  async refreshActiveLotteries() {
    await db.query(`
      REFRESH MATERIALIZED VIEW CONCURRENTLY active_lotteries_view;
    `);
  }
  
  // Batch loading to prevent N+1 queries
  async batchLoadLotteries(ids: string[]) {
    const lotteries = await db.query(`
      SELECT * FROM lottery_games 
      WHERE id = ANY($1)
      AND status = 'active'
    `, [ids]);
    
    // Parallel load related data
    const [entries, prizes] = await Promise.all([
      this.batchLoadEntries(ids),
      this.batchLoadPrizes(ids),
    ]);
    
    return this.mergeLotteryData(lotteries, entries, prizes);
  }
  
  // Connection pooling per lottery
  getConnectionPool(lotteryId: string) {
    const shard = this.calculateShard(lotteryId);
    return this.pools[shard];
  }
}
```

### 9. Monitoring & Analytics

```typescript
// Prometheus metrics for multi-lottery monitoring
const metrics = {
  // Per-lottery metrics
  lottery_entries_total: new Counter({
    name: 'lottery_entries_total',
    help: 'Total entries per lottery',
    labelNames: ['lottery_id', 'lottery_type'],
  }),
  
  lottery_prize_pool: new Gauge({
    name: 'lottery_prize_pool_amount',
    help: 'Current prize pool per lottery',
    labelNames: ['lottery_id', 'currency'],
  }),
  
  // System-wide metrics
  active_lotteries: new Gauge({
    name: 'active_lotteries_count',
    help: 'Number of active lotteries',
  }),
  
  concurrent_players: new Gauge({
    name: 'concurrent_players_total',
    help: 'Total concurrent players across all lotteries',
  }),
  
  // Performance metrics
  lottery_query_duration: new Histogram({
    name: 'lottery_query_duration_seconds',
    help: 'Query duration per lottery operation',
    labelNames: ['operation', 'lottery_id'],
    buckets: [0.1, 0.5, 1, 2, 5],
  }),
};
```

## Deployment Strategy

### Phase 1: Single Lottery Optimization
1. Implement database partitioning
2. Add Redis clustering
3. Set up monitoring

### Phase 2: Multi-Lottery Core
1. Deploy lottery registry
2. Implement lottery manager service
3. Update Solana program

### Phase 3: Scaling Infrastructure
1. Set up Kubernetes cluster
2. Implement service mesh
3. Configure auto-scaling

### Phase 4: Advanced Features
1. Cross-lottery promotions
2. Loyalty programs
3. Analytics dashboard

## Security Considerations

1. **Lottery Isolation**: Each lottery runs in isolated contexts
2. **Rate Limiting**: Per-lottery and per-player limits
3. **Access Control**: Role-based permissions per lottery
4. **Audit Logging**: Complete audit trail for all operations
5. **Data Encryption**: Encrypt sensitive lottery configurations

## Conclusion

This architecture supports unlimited concurrent lotteries while maintaining:
- High performance through sharding and caching
- Real-time updates via WebSocket namespaces
- Scalability through microservices and Kubernetes
- Security through isolation and access control
- Flexibility through configuration-driven design