# Telegram Lottery Bot - Web UI & API Documentation

## Overview

The Telegram Lottery Bot now includes a comprehensive web-based monitoring and management system with:
- Real-time analytics dashboard
- Payment monitoring
- Game management
- System administration
- Error tracking and observability

## Architecture Components

### 1. API Server (Express.js)
- RESTful API endpoints
- WebSocket support for real-time updates
- JWT authentication
- Role-based access control

### 2. Database (PostgreSQL)
- Game metrics and analytics
- Player statistics
- Transaction logs
- Audit trails

### 3. Cache (Redis)
- Session management
- Real-time metrics
- Rate limiting
- Queue management

### 4. Web Dashboard (React)
- Real-time monitoring
- Analytics visualization
- Administrative controls
- Configuration management

## Quick Start

### Using Docker Compose (Recommended)

1. **Clone and setup environment:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

2. **Start all services:**
```bash
docker-compose up -d
```

3. **Access services:**
- Web Dashboard: http://localhost:3000
- API: http://localhost:4000
- pgAdmin: http://localhost:5050 (development profile)

### Manual Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Setup PostgreSQL:**
```bash
psql -U postgres -c "CREATE DATABASE lottery_bot_db;"
psql -U postgres -d lottery_bot_db -f src/database/schema.sql
```

3. **Setup Redis:**
```bash
redis-server
```

4. **Start API server:**
```bash
npm run build
npm run start:api
```

5. **Start bot:**
```bash
npm start
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - Admin login
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/refresh` - Refresh token
- `GET /api/v1/auth/me` - Get current user

### Metrics & Monitoring
- `GET /api/v1/metrics/realtime` - Real-time metrics
- `GET /api/v1/metrics/prometheus` - Prometheus format
- `GET /api/v1/metrics/system` - System health
- `GET /api/v1/metrics/errors` - Error tracking

### Analytics
- `GET /api/v1/analytics/games` - Game statistics
- `GET /api/v1/analytics/revenue` - Revenue analytics
- `GET /api/v1/analytics/players` - Player leaderboard
- `GET /api/v1/analytics/activity` - Activity heatmap

### Configuration
- `GET /api/v1/config` - Get all config
- `PUT /api/v1/config/:key` - Update config
- `POST /api/v1/config/validate` - Validate config

### System Management
- `GET /api/v1/system/health` - Health check
- `POST /api/v1/system/maintenance` - Toggle maintenance
- `GET /api/v1/system/logs` - View logs
- `POST /api/v1/system/cache/clear` - Clear cache

### Admin Functions
- `POST /api/v1/admin/games/:id/cancel` - Cancel game
- `POST /api/v1/admin/payments/:id/refund` - Process refund
- `GET /api/v1/admin/users` - Manage admin users
- `GET /api/v1/admin/audit-logs` - View audit logs

## Authentication

### JWT Authentication
```javascript
// Login request
POST /api/v1/auth/login
{
  "username": "admin",
  "password": "your-password"
}

// Response
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "uuid",
      "username": "admin",
      "role": "super_admin"
    }
  }
}

// Use token in headers
Authorization: Bearer <token>
```

### API Key Authentication
```javascript
// Headers
X-API-Key: your-api-key
```

## User Roles & Permissions

### Roles
- **super_admin**: Full system access
- **admin**: Manage games, payments, users, config
- **moderator**: Manage games and payments
- **viewer**: Read-only access

### Permissions
- `view:*` - View all resources
- `manage:games` - Create, cancel games
- `manage:payments` - Process refunds
- `manage:users` - User management
- `manage:config` - System configuration

## WebSocket Events

### Real-time Updates
```javascript
// Connect to WebSocket
const socket = io('ws://localhost:4000', {
  auth: { token: 'your-jwt-token' }
});

// Join rooms
socket.emit('join:metrics');
socket.emit('join:alerts');

// Listen for updates
socket.on('metrics:update', (data) => {
  console.log('Metrics updated:', data);
});

socket.on('game:cancelled', (data) => {
  console.log('Game cancelled:', data);
});

socket.on('config:updated', (data) => {
  console.log('Config updated:', data);
});
```

## Environment Variables

### Required
```env
# Bot Configuration
BOT_TOKEN=your-telegram-bot-token
DEFAULT_CHAT_ID=-1001234567890

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lottery_bot_db
DB_USER=postgres
DB_PASSWORD=your-password

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
DEFAULT_ADMIN_PASSWORD=changeme123!

# API
API_PORT=4000
CORS_ORIGIN=http://localhost:3000
```

### Optional
```env
# Sentry Error Tracking
SENTRY_DSN=your-sentry-dsn

# Blockchain (for paid features)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
MWOR_TOKEN_MINT=token-mint-address
BOT_WALLET_PRIVATE_KEY=encrypted-key
TREASURY_WALLET_PRIVATE_KEY=encrypted-key
WALLET_ENCRYPTION_KEY=encryption-key
```

## Security Considerations

1. **Change default passwords** immediately
2. **Use strong JWT secrets** in production
3. **Enable HTTPS** with proper certificates
4. **Configure CORS** appropriately
5. **Use environment-specific** configurations
6. **Regular security audits** of dependencies
7. **Monitor access logs** for suspicious activity

## Monitoring & Observability

### Structured Logging
- All events logged with trace IDs
- Log levels: fatal, error, warn, info, debug, trace
- Automatic error classification
- Performance metrics tracking

### Error Handling
- Automatic retry with exponential backoff
- Circuit breakers for external services
- Comprehensive error tracking
- Sentry integration for alerts

### Metrics Collection
- Prometheus-compatible metrics
- Real-time dashboards
- Performance monitoring
- Custom business metrics

## Development

### Running locally
```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Start in development mode
npm run dev

# Start API only
npm run dev:api

# Run tests
npm test
```

### Adding new features
1. Create feature branch
2. Update database schema if needed
3. Add API endpoints
4. Update types and validation
5. Add tests
6. Update documentation

## Production Deployment

### Using Docker
```bash
# Build and start production
docker-compose -f docker-compose.yml up -d

# With monitoring stack
docker-compose --profile monitoring up -d

# View logs
docker-compose logs -f bot
docker-compose logs -f api
```

### Manual Deployment
1. Build TypeScript: `npm run build`
2. Set NODE_ENV=production
3. Configure process manager (PM2)
4. Setup reverse proxy (Nginx)
5. Configure SSL certificates
6. Setup monitoring alerts

## Troubleshooting

### Common Issues

1. **Database connection failed**
   - Check DB_HOST and credentials
   - Ensure PostgreSQL is running
   - Check firewall rules

2. **Redis connection failed**
   - Verify REDIS_URL
   - Check Redis is running
   - Test with redis-cli

3. **Authentication errors**
   - Verify JWT_SECRET matches
   - Check token expiration
   - Clear browser cache

4. **WebSocket not connecting**
   - Check CORS settings
   - Verify firewall rules
   - Test with wscat

### Debug Mode
```bash
# Enable debug logging
LOG_LEVEL=debug npm start

# View detailed SQL queries
DEBUG=knex:query npm start
```

## Support

For issues or questions:
1. Check logs in `./logs` directory
2. View system events in dashboard
3. Check audit logs for admin actions
4. Create issue on GitHub

## License

MIT License - See LICENSE file for details