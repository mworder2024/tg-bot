# Lottery Bot Dashboard & Monitoring Stack

A comprehensive web dashboard with monitoring, centralized logging, and analytics for the Lottery Bot, featuring real-time updates and full administrative control.

## 🚀 Features

### 📊 Dashboard Features
- **Real-time Game Monitoring** - Live view of all active lottery games across groups
- **Administrative Controls** - Create, pause, resume, and end games from the web interface
- **Player Management** - View player lists, eliminations, and game statistics
- **Event Scheduling** - Schedule one-time events and manage recurring games
- **System Monitoring** - Real-time system performance and health metrics
- **WebSocket Updates** - Live updates without page refresh

### 📈 Monitoring Stack
- **Prometheus** - Metrics collection and storage
- **Grafana** - Beautiful dashboards and visualizations
- **Loki** - Centralized log aggregation
- **Node Exporter** - System metrics
- **cAdvisor** - Container metrics
- **Redis** - State management and caching

### 🔐 Security
- Token-based authentication for admin functions
- Protected API endpoints
- CORS configuration for web security

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Web     │    │   Express API   │    │  Telegram Bot   │
│   Dashboard     │◄──►│   + WebSocket   │◄──►│   (Main App)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Grafana       │    │   Prometheus    │    │     Redis       │
│  (Dashboards)   │◄──►│   (Metrics)     │◄──►│   (State)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│      Loki       │    │   Promtail      │    │  Node Exporter  │
│    (Logs)       │◄──►│ (Log Shipper)   │    │ (System Metrics)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## ⚡ Quick Start

### 1. Environment Setup

Create a `.env` file with the required variables:

```bash
# Bot Configuration
BOT_TOKEN=your_telegram_bot_token
ADMIN_USER_IDS=123456789,987654321

# Dashboard Configuration
DASHBOARD_ADMIN_TOKEN=your-secure-admin-token-here

# Optional: Custom Ports
DASHBOARD_PORT=3001
```

### 2. Start Monitoring Stack

Start the full monitoring infrastructure:

```bash
# Start all monitoring services
docker-compose -f docker-compose.monitoring.yml up -d

# Check services are running
docker-compose -f docker-compose.monitoring.yml ps
```

### 3. Start the Bot with Dashboard

```bash
# Install dependencies
npm install

# Build the TypeScript
npm run build

# Start the bot (includes dashboard)
npm start
```

### 4. Access the Interfaces

- **Main Dashboard**: http://localhost:3001
- **Grafana**: http://localhost:3000 (admin/admin123)
- **Prometheus**: http://localhost:9090
- **Bot Metrics**: http://localhost:3001/metrics

## 🖥️ Dashboard Usage

### Authentication
1. Open the dashboard at http://localhost:3001
2. Click "Authenticate" button
3. Enter your `DASHBOARD_ADMIN_TOKEN`
4. Gain access to admin functions

### Managing Games
- **View Active Games**: See all running games across all groups
- **Create Games**: Start new games with custom settings
- **Control Games**: Pause, resume, or end games
- **Monitor Players**: View player lists and elimination status
- **Schedule Events**: Set up one-time events with custom prizes

### System Monitoring
- **Real-time Metrics**: CPU, memory, and system performance
- **Connection Status**: WebSocket connection health
- **Activity Logs**: Recent bot activities and events

## 📊 Grafana Dashboards

Pre-configured dashboards include:

### Game Metrics
- Games created/finished over time
- Active games gauge
- Player activity (joins/eliminations)
- Game duration histograms
- Token distribution tracking

### Bot Performance
- Memory usage (heap used/total)
- Command execution rate
- Error rates and types
- Message processing times
- Telegram API call statistics

### System Health
- CPU and memory utilization
- Container resource usage
- Network I/O metrics
- Disk usage patterns

## 🔧 Configuration Files

### Prometheus (`docker/prometheus/prometheus.yml`)
```yaml
scrape_configs:
  - job_name: 'lottery-bot'
    static_configs:
      - targets: ['host.docker.internal:3001']
    scrape_interval: 10s
```

### Grafana Datasources (`docker/grafana/provisioning/datasources/`)
- Prometheus datasource for metrics
- Loki datasource for logs
- Auto-provisioned dashboards

### Loki (`docker/loki/loki.yml`)
- Log retention: 168 hours (7 days)
- Filesystem storage
- Query caching enabled

## 📈 Metrics Collected

### Game Metrics
- `lottery_games_created_total` - Total games created
- `lottery_games_finished_total` - Total games completed
- `lottery_players_joined_total` - Player participation
- `lottery_active_games` - Current active games
- `lottery_game_duration_seconds` - Game completion times
- `lottery_tokens_distributed_total` - Prize distribution

### Bot Metrics
- `bot_memory_usage_bytes` - Memory consumption
- `bot_uptime_seconds` - Bot uptime
- `bot_messages_processed_total` - Message handling
- `bot_errors_total` - Error tracking
- `lottery_commands_executed_total` - Command usage

### System Metrics
- Standard Node.js metrics
- Container resource usage
- System performance indicators

## 🚨 Alerting (Future Enhancement)

Planned alerting rules:
- High error rates
- Memory usage thresholds
- Game stuck detection
- System performance degradation

## 🔍 Troubleshooting

### Dashboard Not Loading
1. Check if the dashboard API is running on port 3001
2. Verify the bot started successfully
3. Check browser console for JavaScript errors

### Authentication Issues
1. Verify `DASHBOARD_ADMIN_TOKEN` is set correctly
2. Check token matches between `.env` and dashboard input
3. Look for authentication errors in bot logs

### Monitoring Stack Issues
```bash
# Check container status
docker-compose -f docker-compose.monitoring.yml ps

# View container logs
docker-compose -f docker-compose.monitoring.yml logs grafana
docker-compose -f docker-compose.monitoring.yml logs prometheus

# Restart specific service
docker-compose -f docker-compose.monitoring.yml restart grafana
```

### Metrics Not Appearing
1. Verify Prometheus is scraping the bot metrics endpoint
2. Check `/metrics` endpoint returns data: http://localhost:3001/metrics
3. Ensure proper network connectivity between containers

## 📝 Development

### Adding New Metrics
1. Add metric definition to `src/monitoring/prometheus-metrics.ts`
2. Use the metric in relevant bot code
3. Update Grafana dashboards if desired

### Extending the Dashboard
1. Modify `public/dashboard/index.html` for UI changes
2. Update `public/dashboard/dashboard.js` for functionality
3. Add new API endpoints in `src/dashboard/api-server.ts`

### Custom Grafana Dashboards
1. Create dashboards in Grafana UI
2. Export JSON and save to `docker/grafana/dashboards/`
3. Restart Grafana to auto-import

## 🐳 Docker Services

The monitoring stack includes:

- **prometheus** - Metrics collection (port 9090)
- **grafana** - Visualization (port 3000)
- **loki** - Log aggregation (port 3100)
- **promtail** - Log shipping
- **redis** - State storage (port 6379)
- **node-exporter** - System metrics (port 9100)
- **cadvisor** - Container metrics (port 8080)

## 🔒 Security Considerations

- Change default Grafana admin password
- Use strong admin tokens
- Consider HTTPS in production
- Restrict network access to monitoring ports
- Regular security updates for Docker images

## 🚀 Production Deployment

For production:
1. Use environment-specific configuration
2. Set up proper SSL/TLS certificates
3. Configure external data persistence
4. Set up proper backup strategies
5. Implement log rotation
6. Configure alerting for critical issues

---

🎲 **The lottery bot dashboard provides complete visibility and control over your bot's operations with enterprise-grade monitoring capabilities!**