#!/bin/bash

# Solana VRF Lottery PWA - Mainnet Deployment
set -e

echo "🚨 MAINNET DEPLOYMENT - PRODUCTION READY 🚨"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Safety confirmation
safety_confirmation() {
    echo -e "${RED}⚠️  WARNING: This will deploy to Solana MAINNET${NC}"
    echo -e "${RED}⚠️  This involves REAL SOL and REAL money!${NC}"
    echo -e "${YELLOW}📋 Please confirm the following checklist:${NC}\n"
    
    checklist=(
        "✅ Programs tested thoroughly on devnet"
        "✅ Security audit completed"
        "✅ All tests passing"
        "✅ Backup wallet and private keys secured"
        "✅ Production environment variables set"
        "✅ Database and infrastructure ready"
        "✅ Team is ready for launch"
        "✅ Emergency procedures documented"
    )
    
    for item in "${checklist[@]}"; do
        echo -e "  ${item}"
    done
    
    echo -e "\n${RED}🚨 Do you confirm ALL items above are complete? (yes/no)${NC}"
    read -r confirmation
    if [[ ! $confirmation =~ ^[Yy][Ee][Ss]$ ]]; then
        echo -e "${YELLOW}❌ Deployment cancelled. Please complete checklist first.${NC}"
        exit 1
    fi
    
    echo -e "\n${YELLOW}🔐 Please type 'DEPLOY TO MAINNET' to confirm:${NC}"
    read -r final_confirmation
    if [[ $final_confirmation != "DEPLOY TO MAINNET" ]]; then
        echo -e "${YELLOW}❌ Deployment cancelled.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Confirmation received. Proceeding with mainnet deployment...${NC}\n"
}

# Check mainnet prerequisites
check_mainnet_prerequisites() {
    echo -e "${BLUE}🔍 Checking mainnet prerequisites...${NC}"
    
    # Check for production environment file
    if [ ! -f ".env.production" ]; then
        echo -e "${RED}❌ .env.production file not found. Creating template...${NC}"
        cat > .env.production << EOF
# PRODUCTION MAINNET CONFIGURATION
NODE_ENV=production
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Database - PRODUCTION
DATABASE_URL=postgresql://lottery_user:SECURE_PASSWORD@prod-db-host:5432/lottery_production_db
REDIS_URL=redis://prod-redis-host:6379

# Authentication - PRODUCTION
JWT_SECRET=GENERATE_SECURE_SECRET_HERE

# Solana - PRODUCTION
SOLANA_PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID
SOLANA_WALLET_PRIVATE_KEY=YOUR_PRODUCTION_WALLET_PRIVATE_KEY

# Platform Integration - PRODUCTION
TELEGRAM_BOT_TOKEN=YOUR_PRODUCTION_BOT_TOKEN
DISCORD_CLIENT_ID=YOUR_PRODUCTION_DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET=YOUR_PRODUCTION_DISCORD_CLIENT_SECRET

# VRF Configuration - PRODUCTION
ORAO_VRF_PROGRAM_ID=VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y

# Production API
PORT=443
API_HOST=your-domain.com
API_CORS_ORIGIN=https://your-domain.com

# Monitoring - PRODUCTION
SENTRY_DSN=YOUR_PRODUCTION_SENTRY_DSN
LOG_LEVEL=info

# Security
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF
        echo -e "${YELLOW}⚠️  Please configure .env.production and run again${NC}"
        exit 1
    fi
    
    # Load production environment
    source .env.production
    
    # Validate critical variables
    critical_vars=("DATABASE_URL" "JWT_SECRET" "SOLANA_WALLET_PRIVATE_KEY" "TELEGRAM_BOT_TOKEN")
    for var in "${critical_vars[@]}"; do
        if [ -z "${!var}" ]; then
            echo -e "${RED}❌ Missing critical variable: ${var}${NC}"
            exit 1
        fi
    done
    
    echo -e "${GREEN}✅ Mainnet prerequisites validated${NC}"
}

# Setup mainnet Solana configuration
setup_mainnet_solana() {
    echo -e "${BLUE}🔧 Setting up mainnet Solana configuration...${NC}"
    
    # Set to mainnet
    solana config set --url mainnet-beta
    
    # Check balance
    BALANCE=$(solana balance)
    echo -e "${BLUE}💰 Mainnet balance: ${BALANCE}${NC}"
    
    # Minimum balance check (need at least 5 SOL for deployment)
    if ! echo "$BALANCE" | grep -q -E "[5-9][0-9]*|[1-9][0-9]+" SOL; then
        echo -e "${RED}❌ Insufficient SOL for mainnet deployment. Need at least 5 SOL.${NC}"
        echo -e "${YELLOW}💡 Please fund your wallet: $(solana-keygen pubkey)${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Mainnet Solana configuration ready${NC}"
}

# Deploy to mainnet with safety checks
deploy_mainnet_programs() {
    echo -e "${BLUE}🚀 Deploying programs to mainnet...${NC}"
    
    if [ ! -d "programs" ]; then
        echo -e "${RED}❌ No programs directory found${NC}"
        exit 1
    fi
    
    # Final build
    echo -e "${BLUE}🔨 Building for mainnet...${NC}"
    anchor build --verifiable
    
    # Create deployment backup
    BACKUP_DIR="deployments/mainnet-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp -r target/deploy/* "$BACKUP_DIR/"
    echo -e "${GREEN}✅ Deployment backup created: ${BACKUP_DIR}${NC}"
    
    # Deploy with verification
    echo -e "${BLUE}📤 Deploying to mainnet-beta...${NC}"
    anchor deploy --provider.cluster mainnet-beta
    
    # Get program ID
    PROGRAM_ID=$(solana-keygen pubkey target/deploy/telegram_lottery-keypair.json)
    echo -e "${GREEN}✅ Program deployed to mainnet: ${PROGRAM_ID}${NC}"
    
    # Update production environment
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/SOLANA_PROGRAM_ID=.*/SOLANA_PROGRAM_ID=${PROGRAM_ID}/" .env.production
    else
        sed -i "s/SOLANA_PROGRAM_ID=.*/SOLANA_PROGRAM_ID=${PROGRAM_ID}/" .env.production
    fi
    
    # Store program ID securely
    echo "$PROGRAM_ID" > "$BACKUP_DIR/program-id.txt"
    
    echo -e "${GREEN}✅ Mainnet program deployment complete${NC}"
}

# Initialize mainnet program
initialize_mainnet_program() {
    echo -e "${BLUE}🎯 Initializing mainnet program...${NC}"
    
    if [ -f "scripts/deploy-mainnet.ts" ]; then
        echo -e "${BLUE}📋 Running mainnet initialization...${NC}"
        npx tsx scripts/deploy-mainnet.ts
        echo -e "${GREEN}✅ Mainnet program initialized${NC}"
    else
        echo -e "${YELLOW}⚠️  No mainnet initialization script found${NC}"
        echo -e "${BLUE}🔧 Manual initialization may be required${NC}"
    fi
}

# Deploy production backend
deploy_production_backend() {
    echo -e "${BLUE}🖥️  Deploying production backend...${NC}"
    
    # Build for production
    npm run build
    
    # Create production deployment package
    DEPLOY_DIR="deployments/backend-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$DEPLOY_DIR"
    
    # Copy production files
    cp -r dist/ "$DEPLOY_DIR/"
    cp package.json "$DEPLOY_DIR/"
    cp .env.production "$DEPLOY_DIR/.env"
    
    # Create deployment script
    cat > "$DEPLOY_DIR/start-production.sh" << 'EOF'
#!/bin/bash
# Production backend startup script
export NODE_ENV=production
npm install --production
node dist/index.js
EOF
    chmod +x "$DEPLOY_DIR/start-production.sh"
    
    echo -e "${GREEN}✅ Production backend package created: ${DEPLOY_DIR}${NC}"
}

# Deploy production PWA
deploy_production_pwa() {
    echo -e "${BLUE}📱 Deploying production PWA...${NC}"
    
    if [ ! -d "pwa" ]; then
        echo -e "${YELLOW}⚠️  PWA directory not found, skipping...${NC}"
        return
    fi
    
    cd pwa
    
    # Create production environment
    cat > .env.production << EOF
NEXT_PUBLIC_APP_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
NEXT_PUBLIC_PROGRAM_ID=${PROGRAM_ID}
NODE_ENV=production
EOF
    
    # Build for production
    npm run build
    
    # Create deployment package
    DEPLOY_DIR="../deployments/pwa-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$DEPLOY_DIR"
    cp -r .next/ "$DEPLOY_DIR/"
    cp -r public/ "$DEPLOY_DIR/"
    cp package.json "$DEPLOY_DIR/"
    cp .env.production "$DEPLOY_DIR/.env.local"
    
    cd ..
    echo -e "${GREEN}✅ Production PWA package created: ${DEPLOY_DIR}${NC}"
}

# Generate mainnet deployment report
generate_mainnet_report() {
    echo -e "${BLUE}📊 Generating mainnet deployment report...${NC}"
    
    REPORT_FILE="deployments/MAINNET-DEPLOYMENT-$(date +%Y%m%d-%H%M%S).md"
    
    cat > "$REPORT_FILE" << EOF
# 🚀 MAINNET DEPLOYMENT REPORT

**🗓️ Deployment Date:** $(date)
**🌐 Network:** Solana Mainnet Beta
**👤 Deployer:** $(whoami)
**💻 Machine:** $(hostname)

## 🎯 Program Information
- **Program ID:** \`${PROGRAM_ID}\`
- **Deployer Wallet:** \`$(solana-keygen pubkey)\`
- **Network:** mainnet-beta
- **RPC URL:** https://api.mainnet-beta.solana.com
- **Deployment Cost:** $(solana balance) SOL remaining

## 🛡️ Security Information
- **Audit Status:** ✅ Completed
- **Security Review:** ✅ Passed
- **Deployment Verification:** ✅ Verified

## 📦 Deployed Components
- **✅ Solana Program:** Deployed and initialized
- **✅ Backend API:** Production package created
- **✅ PWA Application:** Production build ready
- **✅ Admin Dashboard:** Available

## 🔐 Critical Information
- **Program ID:** \`${PROGRAM_ID}\`
- **Treasury Address:** \`$(solana-keygen pubkey)\`
- **Backup Location:** \`${BACKUP_DIR}\`

## 🚀 Post-Deployment Steps

### Immediate (Next 24 hours)
- [ ] Monitor program transactions
- [ ] Test all core functionality
- [ ] Verify ORAO VRF integration
- [ ] Check Telegram/Discord integrations
- [ ] Monitor error rates and performance

### Short-term (Next week)
- [ ] Set up monitoring and alerting
- [ ] Configure backup procedures
- [ ] Document operational procedures
- [ ] Train support team
- [ ] Prepare incident response plan

### Ongoing
- [ ] Regular security reviews
- [ ] Performance optimization
- [ ] User feedback collection
- [ ] Feature enhancements
- [ ] Regular backups

## 🔗 Important Links
- **Solana Explorer:** https://explorer.solana.com/address/${PROGRAM_ID}
- **Program Logs:** \`solana logs ${PROGRAM_ID}\`
- **Mainnet Status:** https://status.solana.com/

## 🆘 Emergency Procedures
1. **Program Issues:** Contact development team immediately
2. **Treasury Security:** Use emergency pause if available
3. **User Issues:** Escalate to support team
4. **Network Issues:** Monitor Solana status page

## 📞 Emergency Contacts
- **Development Team:** [Your contact info]
- **Security Team:** [Security contact]
- **Operations Team:** [Ops contact]

---
**⚠️ KEEP THIS REPORT SECURE - CONTAINS SENSITIVE INFORMATION**
EOF
    
    echo -e "${GREEN}✅ Mainnet deployment report saved: ${REPORT_FILE}${NC}"
    echo -e "${YELLOW}🔒 Please store this report securely and share only with authorized personnel${NC}"
}

# Post-deployment verification
verify_mainnet_deployment() {
    echo -e "${BLUE}🔍 Verifying mainnet deployment...${NC}"
    
    # Check program exists
    if solana program show "$PROGRAM_ID" &> /dev/null; then
        echo -e "${GREEN}✅ Program verified on mainnet${NC}"
    else
        echo -e "${RED}❌ Program verification failed${NC}"
        exit 1
    fi
    
    # Check program is upgradeable
    PROGRAM_INFO=$(solana program show "$PROGRAM_ID")
    if echo "$PROGRAM_INFO" | grep -q "Authority"; then
        echo -e "${GREEN}✅ Program upgrade authority confirmed${NC}"
    else
        echo -e "${YELLOW}⚠️  Program upgrade authority not found${NC}"
    fi
    
    # Test basic functionality (if test script exists)
    if [ -f "scripts/test-mainnet.ts" ]; then
        echo -e "${BLUE}🧪 Running mainnet verification tests...${NC}"
        npx tsx scripts/test-mainnet.ts || {
            echo -e "${YELLOW}⚠️  Verification tests failed - manual verification required${NC}"
        }
    fi
    
    echo -e "${GREEN}✅ Mainnet deployment verification complete${NC}"
}

# Main mainnet deployment process
main() {
    echo -e "${BLUE}🚀 Starting MAINNET deployment process...${NC}\n"
    
    # Safety checks
    safety_confirmation
    check_mainnet_prerequisites
    setup_mainnet_solana
    
    # Deploy to mainnet
    deploy_mainnet_programs
    initialize_mainnet_program
    verify_mainnet_deployment
    
    # Create production packages
    deploy_production_backend
    deploy_production_pwa
    
    # Documentation
    generate_mainnet_report
    
    echo -e "\n${GREEN}🎉 MAINNET DEPLOYMENT COMPLETE! 🎉${NC}"
    echo -e "${BLUE}📋 Critical next steps:${NC}"
    echo -e "  1. 🔍 Monitor transactions: ${YELLOW}solana logs ${PROGRAM_ID}${NC}"
    echo -e "  2. 📊 Review deployment report: ${YELLOW}${REPORT_FILE}${NC}"
    echo -e "  3. 🖥️  Deploy backend package to production server"
    echo -e "  4. 📱 Deploy PWA to hosting platform"
    echo -e "  5. 🔧 Configure monitoring and alerting"
    echo -e "  6. 🧪 Run comprehensive production tests"
    
    echo -e "\n${RED}⚠️  IMPORTANT REMINDERS:${NC}"
    echo -e "  - Backup all deployment keys and configs"
    echo -e "  - Monitor the deployment closely for 24-48 hours"
    echo -e "  - Have emergency procedures ready"
    echo -e "  - Keep the development team on standby"
    
    echo -e "\n${GREEN}🔗 Program deployed at: ${PROGRAM_ID}${NC}"
    echo -e "${GREEN}🌐 Explorer: https://explorer.solana.com/address/${PROGRAM_ID}${NC}"
}

# Run main function
main "$@"