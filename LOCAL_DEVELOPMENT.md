# Local Development Setup

This guide helps you set up local development without interfering with the production bot running on Railway.

## 🚨 Important: Separate Bot Tokens

**Never use the production bot token for local development!** This will cause conflicts with the Railway deployment.

## Setup Instructions

### 1. Create a Development Bot

1. Go to [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Choose a name like "YourBot Dev" or "YourBot Local"
4. Save the bot token for development use

### 2. Environment Configuration

1. Copy `.env.local` to `.env`:
   ```bash
   cp .env.local .env
   ```

2. Update your `.env` file:
   ```bash
   # Set your development bot token
   BOT_TOKEN_DEV=your-development-bot-token-here
   
   # Keep the production token for Railway
   BOT_TOKEN=production-token-from-railway
   
   # Ensure development environment
   ENVIRONMENT=development
   ```

### 3. Local Redis Setup

The configuration automatically uses `redis://localhost:6379` for development.

#### Option A: Docker Redis
```bash
docker run -d -p 6379:6379 redis:alpine
```

#### Option B: Local Redis Installation
- **Ubuntu/Debian**: `sudo apt install redis-server`
- **macOS**: `brew install redis && brew services start redis`
- **Windows**: Use WSL or Docker

### 4. Start Development

```bash
npm run dev
```

You should see:
```
🔧 Using development bot token for local testing
🔧 Using local Redis for development
```

## Environment Behavior

| Environment | Bot Token | Redis | Purpose |
|------------|-----------|-------|---------|
| `development` | `BOT_TOKEN_DEV` | `REDIS_URL_DEV` | Local testing |
| `production` | `BOT_TOKEN` | `REDIS_URL` | Railway deployment |
| `staging` | `BOT_TOKEN` | `REDIS_URL` | Staging deployment |

## Troubleshooting

### Bot Conflicts
If you see "409 Conflict" errors:
- Check that you're using a different bot token for development
- Ensure `ENVIRONMENT=development` is set
- Restart your local development server

### Redis Connection Issues
```bash
# Test Redis connection
redis-cli ping
# Should return: PONG
```

### Environment Detection
Check the startup logs:
- ✅ `🔧 Using development bot token for local testing`
- ❌ `⚠️ BOT_TOKEN_DEV not set! Using production token...`

If you see the warning, set `BOT_TOKEN_DEV` in your `.env` file.

## Best Practices

1. **Never commit bot tokens** - Use environment variables only
2. **Use separate test groups** - Don't test in production groups
3. **Local Redis only** - Don't connect to production Redis for testing
4. **Clear data between tests** - Use `redis-cli FLUSHDB` if needed

## Production Deployment

The Railway deployment automatically uses:
- `BOT_TOKEN` (production bot)
- `REDIS_URL` (production Redis)
- `ENVIRONMENT=production`

No changes needed for production deployment.