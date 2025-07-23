# Telegram Lottery Bot v3.4

A feature-rich Telegram bot for running lottery/elimination games with scheduled games, dynamic prize pools, and comprehensive admin controls.

## 🎮 Features

### Core Game Features
- **Elimination-style lottery games** - Players select numbers, survivors win prizes
- **Dynamic prize pools** - Prize scales with player count (10K-100K tokens)
- **Flexible game configuration** - Customizable player limits, survivor counts, and timers
- **Real-time game updates** - Live player counts and game status
- **Leaderboard system** - Track wins, games played, and rankings

### Advanced Features
- **Scheduled Games** - Automatic recurring games at set intervals
- **Auto-activation** - Games start automatically when no active game exists
- **Web API** - RESTful API for game management and analytics
- **Payment Integration** - Support for paid entry games (configurable)
- **Multi-group Support** - Run games in multiple Telegram groups
- **VRF Integration** - Verifiable random number generation for fairness

## 🚀 Quick Start

### Prerequisites
- Node.js v18+ 
- PostgreSQL database
- Redis cache (optional)
- Telegram Bot Token

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd lottery_v3.4
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Configure your `.env` file:
```env
BOT_TOKEN=your_telegram_bot_token
DEFAULT_CHAT_ID=your_default_chat_id
DEFAULT_ADMIN_ID=your_telegram_user_id
ADMIN_USER_IDS=comma,separated,admin,ids
DATABASE_URL=postgresql://user:password@localhost:5432/lottery
REDIS_URL=redis://localhost:6379
```

5. Initialize the database:
```bash
npm run db:migrate
```

6. Start the bot:
```bash
# Development
npm run dev:enhanced

# Production
npm run build && npm start
```

## 📝 Bot Commands

### Player Commands
- `/join` - Join the current lottery game
- `/status` - View current game status
- `/scheduled` - View upcoming scheduled games
- `/help` - Display help information

### Admin Commands
- `/create [players] [survivors] [minutes]` - Create a new game
- `/forcestart` - Force start the current game
- `/endgame` - End the current game
- `/schedule <interval> <survivors> [options]` - Set up scheduled games
- `/activatenext` - Manually activate the next scheduled game
- `/addadmin @username` - Add a new admin
- `/deleteadmin @username` - Remove an admin
- `/admin` - View admin panel

### Schedule Command Examples
```
/schedule 2h 3 - Every 2 hours, 3 survivors
/schedule 30m 1 --max 20 - Every 30 min, 1 survivor, max 20 players
/schedule cancel - Cancel scheduled games
/schedule pause - Pause scheduled games
/schedule resume - Resume scheduled games
```

## 💰 Dynamic Prize Pool System

Prize pools scale based on player count:
- **<10 players**: 10,000-20,000 tokens
- **<20 players**: 10,000-35,000 tokens
- **<30 players**: 10,000-50,000 tokens
- **<40 players**: 10,000-70,000 tokens
- **50+ players**: 10,000-100,000 tokens

## 🎯 Game Flow

1. **Game Creation**: Admin creates game or scheduled game activates
2. **Join Phase**: Players join using `/join` command
3. **Number Selection**: Game starts, players automatically assigned numbers
4. **Elimination Rounds**: Numbers drawn until only survivors remain
5. **Prize Distribution**: Winners receive equal share of prize pool

## 🔧 Configuration

### Game Configuration
Default values can be modified in environment variables:
- `MAX_PLAYERS` - Maximum players per game (default: 50)
- `DEFAULT_SURVIVOR_COUNT` - Default number of winners (default: 3)
- `SELECTION_TIMEOUT_SECONDS` - Time for number selection (default: 60)
- `JOIN_TIMEOUT_MINUTES` - Time to join before game starts (default: 5)

### Scheduled Games
- Automatic games at fixed intervals
- Configurable player limits and survivor counts
- Auto-activation when no active game exists (30-minute window)
- Manual override with `/activatenext` command

## 🌐 Web API

The bot includes a REST API for external integrations:

### Endpoints
- `GET /api/games` - List all games
- `GET /api/games/:id` - Get game details
- `POST /api/games` - Create new game
- `GET /api/leaderboard` - Get leaderboard data
- `GET /api/analytics` - Game statistics

See [API Documentation](docs/API_DOCUMENTATION.md) for details.

## 🗄️ Database Schema

The bot uses PostgreSQL with the following main tables:
- `games` - Game records and state
- `players` - Player participation records
- `transactions` - Payment transactions (if enabled)
- `audit_logs` - Admin action logs

## 🐛 Troubleshooting

### Common Issues

1. **Bot not responding**
   - Check bot token is correct
   - Ensure bot has admin rights in group
   - Verify network connectivity

2. **Database connection errors**
   - Check DATABASE_URL format
   - Ensure PostgreSQL is running
   - Verify database exists

3. **Scheduled games not working**
   - Ensure schedule is configured with `/schedule`
   - Check bot has been running continuously
   - Verify no active game is blocking

## 📊 Monitoring

The bot includes built-in monitoring:
- Game metrics and statistics
- Error tracking and logging
- Performance monitoring
- Admin action audit logs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📜 License

This project is licensed under the MIT License.

## 🆘 Support

For issues and questions:
- Create an issue on GitHub
- Contact the development team
- Check [DEV.md](DEV.md) for technical details# tg-bot
