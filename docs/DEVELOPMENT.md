# Developer Documentation

## 📁 Project Structure

```
lottery_v3.4/
├── src/
│   ├── index-enhanced.ts      # Main bot file (enhanced version)
│   ├── index.ts              # Original bot file
│   ├── leaderboard.ts        # Leaderboard management
│   ├── api/                  # REST API implementation
│   │   ├── server.ts         # Express server setup
│   │   ├── routes/           # API route handlers
│   │   └── middleware/       # Auth and validation
│   ├── services/             # Business logic services
│   │   ├── game.service.ts   # Game management
│   │   ├── payment/          # Payment processing
│   │   └── blockchain/       # Blockchain integration
│   ├── utils/                # Utility functions
│   │   ├── logger.ts         # Logging utilities
│   │   ├── game-scheduler.ts # Scheduled games
│   │   ├── prize-manager.ts  # Prize pool management
│   │   └── message-queue.ts  # Message batching
│   └── types/                # TypeScript type definitions
├── dist/                     # Compiled JavaScript
├── tests/                    # Test files
├── docs/                     # Documentation
└── database/                 # Database migrations
```

## 🔧 Core Functions Reference

### Main Bot Functions (index-enhanced.ts)

#### Game Management
```typescript
// Create a new game
bot.command('create', async (ctx) => {...})
// Config: parseGameConfig(commandText: string)

// Join a game
bot.command('join', async (ctx) => {...})

// Start game and number selection
function startGame(chatId: string): void
// Triggers: startNumberSelection(chatId)

// Drawing phase
function startDrawing(chatId: string): void
// Auto-selects numbers for players

// Process elimination round
async function processRound(chatId: string): Promise<void>
// Eliminates players, checks for winners
```

#### Scheduled Games
```typescript
// Create scheduled game
async function createScheduledGame(chatId: string, config: any): Promise<void>

// Schedule management
bot.command('schedule', async (ctx) => {...})
// Uses: GameScheduler.parseInterval(text: string)
// Validates: GameScheduler.validateSchedule(...)

// Manual activation
bot.command('activatenext', async (ctx) => {...})
// Activates next scheduled game immediately
```

#### Utility Functions
```typescript
// Get current game
function getCurrentGame(chatId: string): any

// Check if user is admin
function isAdminUser(userId: string): boolean

// Generate random number
function generateRandomNumber(min: number, max: number): number

// Escape username for Markdown
function escapeUsername(username: string): string

// Generate prize update message
function generatePrizeUpdate(remainingPlayers: number, survivors: number, totalPrize: number): string
```

### Game Scheduler (utils/game-scheduler.ts)

```typescript
class GameScheduler {
  // Create/update schedule
  createSchedule(chatId, interval, survivors, maxPlayers, startMinutes, createdBy): ScheduledGame
  
  // Cancel schedule
  cancelSchedule(chatId: string): boolean
  
  // Pause/resume
  toggleSchedule(chatId: string): boolean
  
  // Get schedule info
  getSchedule(chatId: string): ScheduledGame | undefined
  
  // Check for games to auto-activate
  checkAndActivateScheduledGames(getCurrentGameFn: Function): void
  
  // Parse interval string (e.g., "2h", "30m")
  static parseInterval(text: string): number | null
  
  // Validate schedule parameters
  static validateSchedule(interval, survivors, maxPlayers, startMinutes): ValidationResult
}
```

### Prize Manager (utils/prize-manager.ts)

```typescript
class PrizeManager {
  // Generate dynamic prize based on player count
  generatePrize(gameId: string, playerCount: number): { amount: number; vrfProof: string }
  // <10 players: 10K-20K, <20: 35K max, <30: 50K max, <40: 70K max, 50+: 100K max
  
  // Log prize for game
  logPrize(prizeLog: PrizeLog): void
  
  // Log winners
  logWinners(winners: WinnerLog[]): void
  
  // Get statistics
  getPrizeStats(): PrizeStats
  getUserWinnings(): UserWinnings[]
}
```

### Message Queue (utils/message-queue-manager.ts)

```typescript
class MessageQueueManager {
  // Enqueue message for batching
  enqueue(message: QueuedMessage): void
  
  // Bundle join announcements
  bundleJoinAnnouncement(chatId: string, username: string, playerCount: number, maxPlayers: number): void
  
  // Clear messages by type
  clearGameMessages(chatId: string, reason: string): void
  
  // Process queue
  processQueue(): Promise<void>
}
```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/game.test.ts

# Run in watch mode
npm run test:watch
```

### Test Structure

```typescript
// Example test file: tests/game.test.ts
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getCurrentGame, startGame } from '../src/index-enhanced';

describe('Game Management', () => {
  beforeEach(() => {
    // Setup test environment
  });

  it('should create a new game', () => {
    // Test game creation
  });

  it('should handle player joins', () => {
    // Test join functionality
  });

  afterEach(() => {
    // Cleanup
  });
});
```

### Testing Commands

To test bot commands locally:

1. **Set up test bot**:
```bash
# Create .env.test with test bot token
cp .env .env.test
NODE_ENV=test npm run dev:enhanced
```

2. **Test command flow**:
```
/create 10 2 1      # Create game: 10 players, 2 survivors, 1 min start
/join               # Join the game
/status             # Check game status
/forcestart         # Force start (admin only)
/schedule 5m 1      # Schedule games every 5 minutes
/scheduled          # View upcoming games
/activatenext       # Activate next scheduled game
```

## 🔍 Debugging

### Enable Debug Logging

```typescript
// Set in .env
LOG_LEVEL=debug

// Or in code
import { logger } from './utils/logger';
logger.setLevel('debug');
```

### Common Debug Points

1. **Game State Issues**
```typescript
// Add debug logging in processRound()
logger.debug('Game state:', currentGame);
logger.debug('Active players:', activePlayers.size);
```

2. **Scheduled Game Issues**
```typescript
// Check scheduler state
const schedule = gameScheduler.getSchedule(chatId);
logger.debug('Schedule:', schedule);
```

3. **Message Queue Issues**
```typescript
// Monitor queue processing
messageQueue.on('process', (msg) => {
  logger.debug('Processing message:', msg);
});
```

## 🚀 Deployment

### Production Build

```bash
# Compile TypeScript
npm run build

# Run production build
NODE_ENV=production npm start
```

### Environment Variables

Required for production:
```env
NODE_ENV=production
BOT_TOKEN=<production_token>
DATABASE_URL=<production_db>
REDIS_URL=<production_redis>
LOG_LEVEL=info
```

### Database Migrations

```bash
# Run migrations
npm run db:migrate

# Rollback
npm run db:rollback

# Create new migration
npm run db:migration:create -- --name add_new_table
```

## 📊 Performance Optimization

### Key Optimizations

1. **Message Batching**: Groups multiple join announcements
2. **Lazy Loading**: Games loaded from disk only when needed
3. **Caching**: Redis caching for frequently accessed data
4. **Connection Pooling**: Database connection reuse

### Monitoring Performance

```typescript
// Add performance logging
const startTime = Date.now();
// ... operation ...
logger.info(`Operation took ${Date.now() - startTime}ms`);
```

## 🐛 Error Handling

### Error Types

1. **GameError**: Game-specific errors
2. **SchedulerError**: Scheduling issues
3. **PaymentError**: Payment processing errors
4. **ValidationError**: Input validation failures

### Error Recovery

```typescript
try {
  await processRound(chatId);
} catch (error) {
  if (error instanceof GameError) {
    // Handle game error
    await ctx.reply(`Game error: ${error.message}`);
  } else {
    // Log and notify admins
    logger.error('Unexpected error:', error);
    notifyAdmins('Bot error occurred');
  }
}
```

## 🔐 Security

### Input Validation

- All user inputs sanitized
- Command parameters validated
- SQL injection prevention
- XSS protection in web UI

### Rate Limiting

- Command rate limiting per user
- API endpoint rate limiting
- Message queue throttling

### Authentication

- JWT tokens for API
- Telegram user verification
- Admin role validation

## 📝 Contributing Guidelines

1. **Code Style**: Follow existing patterns
2. **TypeScript**: Maintain type safety
3. **Testing**: Add tests for new features
4. **Documentation**: Update docs for changes
5. **Commits**: Use conventional commits

### Pull Request Process

1. Fork and create feature branch
2. Write tests for new functionality
3. Ensure all tests pass
4. Update documentation
5. Submit PR with clear description

## 🔧 Maintenance

### Regular Tasks

1. **Log Rotation**: Clear old logs weekly
2. **Database Cleanup**: Archive old games monthly
3. **Performance Review**: Monitor metrics
4. **Dependency Updates**: Check for updates

### Health Checks

```typescript
// Add health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    games: gameStates.size
  });
});
```