# Web UI Architecture for Telegram Lottery Bot

## Overview

This document outlines the comprehensive web-based monitoring, analytics, configuration, and observability platform for the Telegram Lottery Bot system. The UI provides real-time insights, administrative controls, and complete system visibility.

## Core Requirements

### 1. Monitoring Dashboard
- **Real-time Metrics**: Active games, players online, payment status
- **System Health**: Bot status, blockchain connectivity, API health
- **Performance Metrics**: Response times, transaction speeds, error rates
- **Alert Management**: Critical issue notifications, threshold alerts

### 2. Analytics Platform
- **Game Analytics**: Win rates, popular numbers, game duration trends
- **Financial Analytics**: Revenue tracking, payment success rates, prize distributions
- **User Analytics**: Player retention, activity patterns, geographic distribution
- **Custom Reports**: Exportable data, scheduled reports, data visualization

### 3. Configuration Management
- **Bot Settings**: Game parameters, timers, limits
- **Payment Configuration**: Fee structures, minimum/maximum bets
- **Feature Toggles**: Enable/disable paid games, maintenance mode
- **Access Control**: Admin roles, permissions, audit logs

### 4. Observability
- **Centralized Logging**: All bot activities, errors, transactions
- **Distributed Tracing**: Request flow visualization
- **Error Tracking**: Automatic error grouping, stack traces
- **Debugging Tools**: Log search, event replay, state inspection

## Technical Stack

### Backend API
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful + WebSocket for real-time updates
- **Authentication**: JWT with role-based access control
- **Database**: PostgreSQL for analytics, Redis for caching
- **Message Queue**: Bull for background jobs

### Frontend Dashboard
- **Framework**: React 18 with TypeScript
- **UI Library**: Material-UI or Ant Design
- **State Management**: Redux Toolkit + RTK Query
- **Charts**: Recharts or Chart.js
- **Real-time**: Socket.io client

### Monitoring & Logging
- **Logging**: Winston with structured logging
- **APM**: OpenTelemetry for tracing
- **Metrics**: Prometheus + Grafana
- **Error Tracking**: Sentry integration
- **Log Aggregation**: Elasticsearch or Loki

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  React Web UI   │────▶│  Express API    │────▶│  Telegram Bot   │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐             │
         │              │                 │             │
         └─────────────▶│   PostgreSQL    │◀────────────┘
                        │                 │
                        └─────────────────┘
                                 │
                        ┌─────────────────┐
                        │                 │
                        │   Redis Cache   │
                        │                 │
                        └─────────────────┘
```

## Database Schema

### Analytics Tables

```sql
-- Game metrics table
CREATE TABLE game_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id VARCHAR(255) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  player_count INT NOT NULL,
  max_number INT NOT NULL,
  duration_seconds INT,
  is_paid BOOLEAN DEFAULT false,
  entry_fee DECIMAL(20, 8),
  prize_pool DECIMAL(20, 8),
  winners_count INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Player analytics table
CREATE TABLE player_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  username VARCHAR(255),
  games_played INT DEFAULT 0,
  games_won INT DEFAULT 0,
  total_spent DECIMAL(20, 8) DEFAULT 0,
  total_won DECIMAL(20, 8) DEFAULT 0,
  last_active TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction logs table
CREATE TABLE transaction_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type VARCHAR(50) NOT NULL,
  user_id VARCHAR(255),
  game_id VARCHAR(255),
  amount DECIMAL(20, 8),
  token VARCHAR(50),
  status VARCHAR(50),
  blockchain_hash VARCHAR(255),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System events table
CREATE TABLE system_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  component VARCHAR(100),
  message TEXT,
  details JSONB,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configuration table
CREATE TABLE bot_configuration (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## API Endpoints

### Dashboard APIs
```typescript
// Real-time metrics
GET /api/v1/metrics/realtime
WebSocket /ws/metrics

// Analytics endpoints
GET /api/v1/analytics/games?from=date&to=date
GET /api/v1/analytics/revenue?period=daily|weekly|monthly
GET /api/v1/analytics/players/active
GET /api/v1/analytics/players/:userId/history

// Configuration endpoints
GET /api/v1/config
PUT /api/v1/config/:key
POST /api/v1/config/validate

// System management
GET /api/v1/system/health
GET /api/v1/system/status
POST /api/v1/system/maintenance
GET /api/v1/system/logs?level=error&from=date

// Admin actions
POST /api/v1/admin/games/:gameId/cancel
POST /api/v1/admin/payments/:paymentId/refund
GET /api/v1/admin/audit-logs
```

## Frontend Components

### 1. Dashboard Layout
```typescript
interface DashboardLayout {
  header: NavigationBar;
  sidebar: {
    monitoring: MonitoringMenu;
    analytics: AnalyticsMenu;
    configuration: ConfigMenu;
    admin: AdminMenu;
  };
  mainContent: RouterOutlet;
  notifications: NotificationCenter;
}
```

### 2. Real-time Monitoring
```typescript
interface MonitoringDashboard {
  systemStatus: StatusCard[];
  activeGames: GameListWidget;
  realtimeMetrics: {
    playersOnline: MetricCard;
    activeGames: MetricCard;
    paymentsProcessing: MetricCard;
    revenue24h: MetricCard;
  };
  alerts: AlertsWidget;
  performanceCharts: {
    responseTime: LineChart;
    errorRate: LineChart;
    throughput: AreaChart;
  };
}
```

### 3. Analytics Views
```typescript
interface AnalyticsViews {
  gameAnalytics: {
    overview: SummaryCards;
    trends: TrendCharts;
    heatmap: ActivityHeatmap;
    topPlayers: LeaderboardTable;
  };
  financialAnalytics: {
    revenue: RevenueChart;
    paymentSuccess: SuccessRateChart;
    distribution: PieChart;
    transactions: TransactionTable;
  };
  userAnalytics: {
    retention: CohortChart;
    engagement: EngagementMetrics;
    geographic: WorldMap;
    behavior: BehaviorFlow;
  };
}
```

## Logging Architecture

### Structured Logging Format
```typescript
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  service: string;
  component: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  gameId?: string;
  message: string;
  metadata: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
}
```

### Log Aggregation Pipeline
```
Bot/API Logs → Winston → Log Shipper → Elasticsearch → Kibana Dashboard
                  ↓
                Sentry (for errors)
                  ↓
            Alert Manager
```

## Error Handling Strategy

### 1. Error Classification
```typescript
enum ErrorSeverity {
  LOW = 'low',        // Logged only
  MEDIUM = 'medium',  // Alert after threshold
  HIGH = 'high',      // Immediate alert
  CRITICAL = 'critical' // Page admin + alert
}

interface ErrorHandler {
  classify(error: Error): ErrorSeverity;
  handle(error: Error, context: ErrorContext): void;
  alert(error: Error, severity: ErrorSeverity): void;
  recover(error: Error): Promise<boolean>;
}
```

### 2. Error Recovery
- **Automatic Retry**: For transient errors (network, timeout)
- **Circuit Breaker**: For external service failures
- **Graceful Degradation**: Fallback to cached data
- **Manual Intervention**: Admin tools for resolution

## Security Considerations

### Authentication & Authorization
- **Multi-factor Authentication**: For admin access
- **Role-based Access Control**: Granular permissions
- **API Key Management**: For service-to-service auth
- **Session Management**: Secure session handling

### Data Security
- **Encryption at Rest**: For sensitive data
- **Encryption in Transit**: TLS 1.3
- **PII Handling**: Data masking in logs
- **Audit Logging**: All admin actions tracked

## Deployment Architecture

### Container Setup
```yaml
services:
  web-ui:
    image: lottery-bot-ui:latest
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://api:4000
  
  api:
    image: lottery-bot-api:latest
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://...
  
  postgres:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    
  elasticsearch:
    image: elasticsearch:8.11.0
    
  kibana:
    image: kibana:8.11.0
```

## Performance Requirements

### Response Times
- **Dashboard Load**: < 2 seconds
- **API Response**: < 200ms (p95)
- **Real-time Updates**: < 100ms latency
- **Search Queries**: < 500ms

### Scalability
- **Concurrent Users**: Support 1000+ admins
- **Data Retention**: 90 days hot, 1 year cold
- **Log Ingestion**: 10k logs/second
- **Metrics Storage**: 1M data points/hour

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- Express API setup
- PostgreSQL schema
- Basic authentication
- Structured logging

### Phase 2: Monitoring Dashboard (Week 2)
- React UI scaffold
- Real-time WebSocket
- System status cards
- Basic metrics display

### Phase 3: Analytics Platform (Week 3)
- Game analytics
- Revenue tracking
- Player metrics
- Chart components

### Phase 4: Configuration UI (Week 4)
- Settings management
- Feature toggles
- Access control
- Audit logging

### Phase 5: Observability (Week 5)
- Log aggregation
- Error tracking
- Distributed tracing
- Alert system

### Phase 6: Polish & Deploy (Week 6)
- Performance optimization
- Security hardening
- Documentation
- Production deployment

## Success Metrics

### Technical KPIs
- **Uptime**: 99.9% availability
- **Performance**: < 200ms API response
- **Error Rate**: < 0.1% of requests
- **Log Processing**: < 1s ingestion delay

### Business KPIs
- **Admin Efficiency**: 50% reduction in support time
- **Issue Resolution**: 80% faster problem identification
- **Revenue Visibility**: Real-time tracking accuracy
- **User Insights**: Actionable analytics adoption

## Conclusion

This web UI architecture provides a comprehensive solution for monitoring, analyzing, and managing the Telegram Lottery Bot system. The platform enables administrators to maintain system health, understand user behavior, and make data-driven decisions while ensuring robust error handling and observability.