# 🚀 Deployment Guide - Solana VRF Lottery PWA

## 🎯 **Quick Start Deployment**

### **Prerequisites**
- Node.js 18+ 
- PostgreSQL 14+
- Redis 6+
- Solana CLI
- Docker (optional)

### **Environment Setup**

1. **Clone and Install**
```bash
cd telegram-lottery-bot
npm install
cd pwa && npm install
cd ../web && npm install
```

2. **Environment Variables**
```bash
# Copy and configure environment files
cp .env.example .env
cp pwa/.env.example pwa/.env.local
cp web/.env.example web/.env.local
```

3. **Required Environment Variables**
```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/lottery_db
REDIS_URL=redis://localhost:6379

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=YOUR_PROGRAM_ID
SOLANA_WALLET_PRIVATE_KEY=YOUR_PRIVATE_KEY

# Authentication
JWT_SECRET=your-jwt-secret-here

# Platform Integration
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret

# VRF Configuration
ORAO_VRF_PROGRAM_ID=VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y
```

## 🏗️ **Deployment Options**

### **Option 1: Traditional Deployment**

#### **1. Database Setup**
```bash
# Create database
createdb lottery_db

# Run migrations
npm run migrate
```

#### **2. Build Applications**
```bash
# Build backend
npm run build

# Build PWA
cd pwa && npm run build

# Build admin dashboard
cd ../web && npm run build
```

#### **3. Start Services**
```bash
# Start backend API
npm start

# Start PWA (in separate terminal)
cd pwa && npm start

# Start admin dashboard (in separate terminal)  
cd web && npm start
```

### **Option 2: Docker Deployment**

```bash
# Build and start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### **Option 3: Platform-Specific Deployment**

#### **Telegram Mini App**
1. Create Mini App via @BotFather
2. Set Web App URL to your PWA domain
3. Configure webhook for bot updates

#### **Discord Activity**
1. Create Discord Application
2. Configure Activity settings
3. Set Activity URL to your PWA domain

#### **Web PWA**
1. Deploy to any hosting platform
2. Configure HTTPS (required for PWA)
3. Test PWA installation

## 🔧 **Production Configuration**

### **1. Security Hardening**
```bash
# Generate secure JWT secret
openssl rand -base64 32

# Configure HTTPS
# Use Let's Encrypt or similar SSL certificate

# Set up firewall rules
# Allow only necessary ports (80, 443, DB ports)
```

### **2. Performance Optimization**
```bash
# Enable Gzip compression
# Configure CDN for static assets
# Set up Redis caching
# Configure database connection pooling
```

### **3. Monitoring Setup**
```bash
# Install monitoring tools
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js

# Monitor logs
pm2 logs

# Set up health checks
pm2 install pm2-auto-pull
```

## 📱 **Platform Integration**

### **Telegram Bot Setup**
1. Message @BotFather: `/newbot`
2. Get bot token
3. Set webhook: `/setwebhook`
4. Configure Mini App: `/newapp`

### **Discord Integration**
1. Create Discord Application
2. Configure OAuth2 settings
3. Set up Activity in Developer Portal
4. Test Activity in Discord

### **Web PWA Manifest**
```json
{
  "name": "Solana Lottery PWA",
  "short_name": "SolLottery",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1e1b4b",
  "theme_color": "#6366f1"
}
```

## 🛡️ **Security Checklist**

### **Pre-Deployment Security**
- [ ] All secrets in environment variables
- [ ] JWT secret is cryptographically secure
- [ ] Database credentials are unique
- [ ] HTTPS is configured
- [ ] CORS is properly configured
- [ ] Rate limiting is enabled
- [ ] Input validation is implemented

### **Blockchain Security**
- [ ] Program deployed to correct network
- [ ] Treasury wallet is secured
- [ ] VRF oracle is properly configured
- [ ] Transaction limits are set
- [ ] Emergency pause mechanism works

### **Platform Security**
- [ ] Telegram webhook is HTTPS
- [ ] Discord OAuth is configured
- [ ] Web app has CSP headers
- [ ] Session management is secure

## 📊 **Monitoring & Analytics**

### **Health Checks**
```bash
# API health
curl http://localhost:4000/health

# Database health
curl http://localhost:4000/api/v1/system/health

# Blockchain connectivity
curl http://localhost:4000/api/v1/system/blockchain-status
```

### **Key Metrics to Monitor**
- API response times
- Database connection pool
- Redis cache hit rate
- Blockchain transaction success rate
- PWA installation rate
- User engagement by platform

### **Logging Configuration**
```javascript
// Winston logging levels
{
  error: "errors requiring immediate attention",
  warn: "warning conditions", 
  info: "informational messages",
  debug: "debug-level messages"
}
```

## 🚀 **Go-Live Process**

### **1. Pre-Launch Testing**
```bash
# Run test suite
npm test

# Load testing
npm run test:load

# Security scanning
npm audit
npm run security:scan
```

### **2. Staging Deployment**
1. Deploy to staging environment
2. Test all platforms (Web, Telegram, Discord)
3. Verify blockchain transactions
4. Test payment flows
5. Performance testing

### **3. Production Launch**
1. DNS configuration
2. SSL certificate installation
3. Production deployment
4. Platform registration (Telegram, Discord)
5. Monitoring setup
6. Backup verification

### **4. Post-Launch Monitoring**
- Monitor error rates
- Check performance metrics
- Verify blockchain transactions
- User feedback collection
- Security monitoring

## 🔧 **Troubleshooting**

### **Common Issues**

#### **Build Errors**
```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install

# TypeScript errors
npm run type-check
```

#### **Database Connection**
```bash
# Test connection
npm run db:test

# Reset database
npm run db:reset
npm run migrate
```

#### **Blockchain Issues**
```bash
# Check Solana connection
solana config get

# Test program deployment
anchor test

# Verify wallet balance
solana balance
```

### **Performance Issues**
- Check Redis cache hit rate
- Monitor database query performance
- Verify CDN configuration
- Review bundle sizes

### **Security Issues**
- Rotate JWT secrets
- Update dependencies
- Review access logs
- Check firewall rules

## 📞 **Support & Maintenance**

### **Regular Maintenance**
- Weekly dependency updates
- Monthly security scans
- Quarterly performance reviews
- Annual security audits

### **Backup Strategy**
- Daily database backups
- Weekly configuration backups
- Monthly full system backups
- Test restore procedures quarterly

### **Incident Response**
1. Monitor alerts and logs
2. Identify root cause
3. Implement fix
4. Document resolution
5. Update procedures

---

**🎉 Your Solana VRF Lottery PWA is ready for production!**

For additional support, refer to the project documentation or contact the development team.