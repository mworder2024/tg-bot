# 🚀 Deployment Scripts - Solana VRF Lottery PWA

This directory contains comprehensive deployment scripts for local development, devnet testing, and mainnet production deployment.

## 📋 **Quick Start Guide**

### **1. Initial Setup**
```bash
# Install all dependencies
./scripts/setup/install-dependencies.sh

# Setup development environment
./scripts/setup/setup-environment.sh
```

### **2. Local Development**
```bash
# Start local development environment
./scripts/deployment/local-dev.sh

# Stop local services
./scripts/deployment/stop-local.sh

# Restart local services
./scripts/deployment/restart-local.sh
```

### **3. Devnet Testing**
```bash
# Deploy to Solana devnet
./scripts/deployment/devnet-deploy.sh
```

### **4. Mainnet Production**
```bash
# Deploy to Solana mainnet (PRODUCTION)
./scripts/deployment/mainnet-deploy.sh
```

## 📁 **Script Organization**

### **Setup Scripts** (`scripts/setup/`)

#### **`install-dependencies.sh`**
- Installs Node.js dependencies for all components
- Installs Solana CLI and Anchor Framework
- Handles peer dependency conflicts
- Cross-platform compatibility (macOS/Linux)

**Usage:**
```bash
./scripts/setup/install-dependencies.sh
```

**Features:**
- ✅ Node.js version validation (requires 18+)
- ✅ Automatic dependency resolution
- ✅ Optional Solana tools installation
- ✅ Error handling and recovery

#### **`setup-environment.sh`**
- Creates environment configuration files
- Sets up PostgreSQL database
- Configures Redis cache
- Generates Solana keypairs
- Requests devnet airdrops

**Usage:**
```bash
./scripts/setup/setup-environment.sh
```

**Creates:**
- `.env` - Backend configuration
- `pwa/.env.local` - PWA configuration
- `web/.env.local` - Dashboard configuration
- Solana keypair and devnet funding

### **Deployment Scripts** (`scripts/deployment/`)

#### **`local-dev.sh`**
- Complete local development environment
- Builds and starts all services
- Health checks and service monitoring
- Real-time status display

**Usage:**
```bash
./scripts/deployment/local-dev.sh
```

**Services Started:**
- 🖥️ Backend API (port 4000)
- 📱 PWA Application (port 3000)
- 🌐 Admin Dashboard (port 3001)

**Features:**
- ✅ Automatic service health checks
- ✅ Graceful shutdown handling
- ✅ Real-time log monitoring
- ✅ Service restart capabilities

#### **`devnet-deploy.sh`**
- Deploys Solana programs to devnet
- Configures applications for devnet testing
- Runs comprehensive tests
- Generates deployment reports

**Usage:**
```bash
./scripts/deployment/devnet-deploy.sh
```

**Process:**
1. 🔍 Validates prerequisites
2. ⚡ Funds wallet with devnet SOL
3. 🚀 Deploys Anchor programs
4. 🎯 Initializes program state
5. 🧪 Runs integration tests
6. 📊 Generates deployment report

#### **`mainnet-deploy.sh`**
- **PRODUCTION** deployment to Solana mainnet
- Comprehensive safety checks
- Security validations
- Emergency procedures

**Usage:**
```bash
./scripts/deployment/mainnet-deploy.sh
```

**Safety Features:**
- 🚨 Multiple confirmation prompts
- ✅ Security checklist validation
- 💰 Balance verification (minimum 5 SOL)
- 🔒 Backup creation
- 📊 Deployment verification

**⚠️ WARNING:** This deploys to MAINNET with real SOL!

#### **`stop-local.sh`**
- Stops all local development services
- Cleans up PID files and processes
- Optional log file cleanup
- Port conflict resolution

**Usage:**
```bash
./scripts/deployment/stop-local.sh
```

#### **`restart-local.sh`**
- Restarts local development environment
- Combines stop and start operations
- Handles cleanup and initialization

**Usage:**
```bash
./scripts/deployment/restart-local.sh
```

## 🔧 **Configuration Files**

### **Environment Variables**

#### **Backend (`.env`)**
```env
# Database
DATABASE_URL=postgresql://lottery_user:lottery_pass@localhost:5432/lottery_db
REDIS_URL=redis://localhost:6379

# Solana
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=11111111111111111111111111111111

# Authentication
JWT_SECRET=your-secure-secret

# Platform Integration
TELEGRAM_BOT_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-discord-id
```

#### **PWA (`pwa/.env.local`)**
```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_PROGRAM_ID=your-program-id
```

#### **Web Dashboard (`web/.env.local`)**
```env
REACT_APP_API_URL=http://localhost:4000
REACT_APP_WS_URL=ws://localhost:4000
```

## 🗂️ **Generated Files**

### **Deployment Reports**
- `devnet-deployment-YYYYMMDD-HHMMSS.md`
- `MAINNET-DEPLOYMENT-YYYYMMDD-HHMMSS.md`

### **Backups**
- `deployments/mainnet-YYYYMMDD-HHMMSS/`
- `deployments/backend-YYYYMMDD-HHMMSS/`
- `deployments/pwa-YYYYMMDD-HHMMSS/`

### **Process Files**
- `tmp/backend.pid`
- `tmp/pwa.pid` 
- `tmp/web.pid`

## 🔍 **Troubleshooting**

### **Common Issues**

#### **Port Already in Use**
```bash
# Find and kill process on port
lsof -ti:4000 | xargs kill

# Or use the stop script
./scripts/deployment/stop-local.sh
```

#### **Database Connection Failed**
```bash
# Start PostgreSQL
brew services start postgresql  # macOS
sudo systemctl start postgresql # Linux

# Check connection
pg_isready -h localhost -p 5432
```

#### **Solana CLI Not Found**
```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"

# Add to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

#### **Build Failures**
```bash
# Clean and reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Clear TypeScript cache
npx tsc --build --clean
```

### **Log Locations**
- Backend logs: `logs/backend.log`
- Application logs: `logs/app.log`
- Error logs: `logs/error.log`

### **Health Checks**
```bash
# Backend health
curl http://localhost:4000/health

# PWA health
curl http://localhost:3000

# Database health
curl http://localhost:4000/api/v1/system/health
```

## 🆘 **Emergency Procedures**

### **Development Issues**
1. Run `./scripts/deployment/stop-local.sh`
2. Check logs for errors
3. Restart with `./scripts/deployment/local-dev.sh`

### **Deployment Issues**
1. Check Solana network status
2. Verify wallet balance
3. Review deployment logs
4. Contact development team

### **Mainnet Emergencies**
1. **STOP** all operations immediately
2. Use emergency pause if available
3. Contact security team
4. Document incident

## 📞 **Support**

For script issues or deployment help:
1. Check the troubleshooting section above
2. Review generated deployment reports
3. Check log files for detailed errors
4. Contact the development team

---

**🎉 Happy Deploying!** These scripts are designed to make deployment as smooth as possible across all environments.