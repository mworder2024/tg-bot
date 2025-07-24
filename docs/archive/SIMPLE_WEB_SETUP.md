# 🚀 Simple Web Lottery Setup

## What This Gives You
- ✅ Web interface that mirrors your Telegram bot
- ✅ Real-time sync between platforms
- ✅ Same database, same game logic
- ✅ Support for multiple lottery types
- ✅ NO GraphQL complexity

## Setup Steps (15 minutes)

### 1. Update Your Server
In your `src/api/server.ts`, add these lines:

```typescript
import simpleLotteryRoutes from './routes/simple-lottery';

// After other middleware
app.use(express.static('public'));  // Serve HTML
app.use('/api', simpleLotteryRoutes);
app.set('io', io);  // Make Socket.io available
```

### 2. Update Your Telegram Bot
In your bot code, add sync calls:

```typescript
import { LotterySync } from './utils/lottery-sync';

// Create sync instance
const sync = new LotterySync(io);

// When someone joins via Telegram
bot.command('join', async (ctx) => {
  // ... your existing join logic ...
  
  // Add this line to notify web users
  sync.playerJoinedFromTelegram(gameId, username, wallet);
});
```

### 3. Start Everything
```bash
# Terminal 1: Start your API server
npm run dev:api

# Terminal 2: Start your Telegram bot
npm run dev

# Visit: http://localhost:3000
```

## Multi-Lottery Support (Super Simple)

### 1. Add Type to Games Table
```sql
ALTER TABLE games ADD COLUMN type VARCHAR(20) DEFAULT 'instant';
-- Values: 'instant', 'daily', 'weekly'
```

### 2. Simple Scheduler in Your Bot
```typescript
// In your bot initialization
setInterval(async () => {
  const hour = new Date().getHours();
  
  // Daily lottery at 8 PM
  if (hour === 20) {
    const existing = await db.query(
      "SELECT id FROM games WHERE type = 'daily' AND DATE(created_at) = CURRENT_DATE"
    );
    
    if (existing.rows.length === 0) {
      await createLottery('daily', '24 hours');
      sync.lotteryCreated(gameId, 'daily', drawTime);
    }
  }
}, 3600000); // Check every hour
```

## That's It! 🎉

You now have:
- Web interface at `http://localhost:3000`
- Real-time sync with Telegram
- Multi-lottery support
- Same database, same game logic
- Zero GraphQL complexity

## Optional Enhancements

### Make It Pretty (30 minutes)
Replace the basic HTML with a simple React app:

```bash
# Create a simple React app in the public folder
npx create-react-app web-client --template typescript
cd web-client
npm install socket.io-client @solana/web3.js
```

### Add Basic Auth (15 minutes)
```typescript
// Simple JWT auth for web users
router.post('/auth/wallet', async (req, res) => {
  const { walletAddress, signature } = req.body;
  // Verify signature
  const token = jwt.sign({ wallet: walletAddress }, process.env.JWT_SECRET);
  res.json({ token });
});
```

### Deploy to Production (10 minutes)
```bash
# Your existing server can handle both!
npm run build
npm start  # Runs both API and serves web app
```

## Why This Approach?

1. **Uses what you have** - Express, Socket.io, PostgreSQL
2. **No new dependencies** - Everything already in your package.json
3. **Share everything** - Same DB, same logic, same server
4. **Real-time by default** - Socket.io you already have
5. **Scale later** - Add complexity only when needed

## Common Issues

**CORS errors?**
Your server.ts already has CORS setup, just add your domain:
```typescript
cors({
  origin: ['http://localhost:3000', 'https://yourdomain.com']
})
```

**Database connection?**
Use your existing pool from the bot:
```typescript
import { pool } from '../db/connection';
```

**Wallet not connecting?**
Make sure users have Phantom wallet installed.

## Total Time: 1-2 Days
- Day 1: Basic functionality
- Day 2: Polish and deploy

No GraphQL, no complex architecture, just a simple web interface for your lottery! 🎲