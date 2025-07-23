# Railway Deployment Troubleshooting

## Common Crash Issues and Solutions

### 1. Missing BOT_TOKEN
**Error**: "Missing required environment variables: ['BOT_TOKEN']"

**Solution**:
```bash
railway variables set BOT_TOKEN=your-telegram-bot-token
```

### 2. Build Failures
**Error**: TypeScript compilation errors

**Solution**:
- Use the simplified `index-railway.ts` for initial deployment
- Ensure all dependencies are in `package.json` (not devDependencies)

### 3. Memory Issues
**Error**: Process killed or out of memory

**Solution**:
- Upgrade Railway plan for more memory
- Remove unnecessary dependencies
- Use environment variables to disable features:
  ```bash
  railway variables set ENABLE_BLOCKCHAIN=false
  railway variables set ENABLE_QUIZ_MODE=false
  ```

### 4. Database Connection Issues
**Error**: "ECONNREFUSED" or database timeout

**Solution**:
- Start with bot only (no database required for basic operation)
- Add PostgreSQL service in Railway dashboard later
- Set `DATABASE_URL` only after database is created

### 5. Redis Connection Issues
**Error**: Redis connection failed

**Solution**:
- Bot can run without Redis initially
- Add Redis service in Railway dashboard later
- Set `REDIS_URL` only after Redis is created

## Minimal Deployment Steps

1. **Set only required variables first**:
   ```bash
   railway variables set BOT_TOKEN=your-bot-token
   railway variables set ENVIRONMENT=production
   railway variables set LOG_LEVEL=info
   ```

2. **Deploy minimal version**:
   ```bash
   git add src/index-railway.ts railway.json RAILWAY_TROUBLESHOOTING.md
   git commit -m "Add Railway-specific startup with error handling"
   git push
   railway up
   ```

3. **Check logs immediately**:
   ```bash
   railway logs -f
   ```

4. **Test bot**:
   - Message your bot with `/start`
   - Should respond: "Bot is running on Railway! 🚂"

## Debug Commands

```bash
# View all logs
railway logs

# Follow logs in real-time
railway logs -f

# Check deployment status
railway status

# View all environment variables
railway variables

# Restart deployment
railway restart

# Run command in Railway environment
railway run npm list
```

## Gradual Feature Enablement

After basic bot is running:

1. **Add PostgreSQL**:
   - New Service → Database → PostgreSQL
   - Railway auto-sets `DATABASE_URL`

2. **Add Redis**:
   - New Service → Database → Redis
   - Railway auto-sets `REDIS_URL`

3. **Enable features one by one**:
   ```bash
   railway variables set ENABLE_WEB_DASHBOARD=true
   railway variables set ENABLE_BLOCKCHAIN=true
   ```

## Emergency Fixes

If bot keeps crashing:

1. **Use minimal bot**:
   ```bash
   railway variables set START_MINIMAL=true
   ```

2. **Disable all features**:
   ```bash
   railway variables set DISABLE_ALL_FEATURES=true
   ```

3. **Increase timeouts**:
   ```bash
   railway variables set BOT_TIMEOUT=120000
   railway variables set HANDLER_TIMEOUT=90000
   ```

## Contact Support

If issues persist:
- Railway Discord: https://discord.gg/railway
- Railway Support: support@railway.app
- Include deployment ID from `railway status`