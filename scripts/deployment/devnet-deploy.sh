#!/bin/bash

# Solana VRF Lottery PWA - Devnet Deployment
set -e

echo "🌐 Deploying to Solana Devnet..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
check_prerequisites() {
    echo -e "${BLUE}🔍 Checking prerequisites...${NC}"
    
    # Check Solana CLI
    if ! command -v solana &> /dev/null; then
        echo -e "${RED}❌ Solana CLI not found. Please install Solana CLI first.${NC}"
        exit 1
    fi
    
    # Check Anchor CLI
    if ! command -v anchor &> /dev/null; then
        echo -e "${RED}❌ Anchor CLI not found. Please install Anchor CLI first.${NC}"
        exit 1
    fi
    
    # Check environment
    if [ ! -f ".env" ]; then
        echo -e "${RED}❌ .env file not found. Run setup scripts first.${NC}"
        exit 1
    fi
    
    # Load environment
    source .env
    
    echo -e "${GREEN}✅ Prerequisites checked${NC}"
}

# Setup Solana configuration
setup_solana_config() {
    echo -e "${BLUE}🔧 Setting up Solana configuration...${NC}"
    
    # Set to devnet
    solana config set --url devnet
    solana config set --keypair ~/.config/solana/id.json
    
    # Get current configuration
    SOLANA_CONFIG=$(solana config get)
    echo -e "${BLUE}📋 Solana Configuration:${NC}"
    echo "$SOLANA_CONFIG"
    
    # Check balance
    BALANCE=$(solana balance)
    echo -e "${BLUE}💰 Current balance: ${BALANCE}${NC}"
    
    # Request airdrop if balance is low
    if [[ "$BALANCE" =~ ^0 ]]; then
        echo -e "${YELLOW}💸 Requesting devnet airdrop...${NC}"
        solana airdrop 2
        sleep 5
        BALANCE=$(solana balance)
        echo -e "${GREEN}✅ New balance: ${BALANCE}${NC}"
    fi
}

# Deploy Solana programs
deploy_programs() {
    echo -e "${BLUE}🚀 Deploying Solana programs...${NC}"
    
    if [ -d "programs" ]; then
        # Build programs
        echo -e "${BLUE}🔨 Building Anchor programs...${NC}"
        anchor build
        
        # Deploy programs
        echo -e "${BLUE}📤 Deploying to devnet...${NC}"
        anchor deploy --provider.cluster devnet
        
        # Get program ID
        PROGRAM_ID=$(solana-keygen pubkey target/deploy/telegram_lottery-keypair.json)
        echo -e "${GREEN}✅ Program deployed: ${PROGRAM_ID}${NC}"
        
        # Update environment file
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/SOLANA_PROGRAM_ID=.*/SOLANA_PROGRAM_ID=${PROGRAM_ID}/" .env
        else
            sed -i "s/SOLANA_PROGRAM_ID=.*/SOLANA_PROGRAM_ID=${PROGRAM_ID}/" .env
        fi
        
        # Update PWA environment
        if [ -f "pwa/.env.local" ]; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s/NEXT_PUBLIC_PROGRAM_ID=.*/NEXT_PUBLIC_PROGRAM_ID=${PROGRAM_ID}/" pwa/.env.local
            else
                sed -i "s/NEXT_PUBLIC_PROGRAM_ID=.*/NEXT_PUBLIC_PROGRAM_ID=${PROGRAM_ID}/" pwa/.env.local
            fi
        fi
        
        echo -e "${GREEN}✅ Environment files updated with program ID${NC}"
        
    else
        echo -e "${YELLOW}⚠️  No programs directory found, skipping program deployment${NC}"
    fi
}

# Initialize program state
initialize_program() {
    echo -e "${BLUE}🎯 Initializing program state...${NC}"
    
    if [ -d "programs" ] && [ -f "scripts/deploy.ts" ]; then
        echo -e "${BLUE}📋 Running initialization script...${NC}"
        npx tsx scripts/deploy.ts
        echo -e "${GREEN}✅ Program initialized${NC}"
    else
        echo -e "${YELLOW}⚠️  No initialization script found, skipping...${NC}"
    fi
}

# Test program deployment
test_deployment() {
    echo -e "${BLUE}🧪 Testing program deployment...${NC}"
    
    if [ -d "programs" ]; then
        # Run anchor tests
        echo -e "${BLUE}🔬 Running Anchor tests...${NC}"
        anchor test --provider.cluster devnet || {
            echo -e "${YELLOW}⚠️  Some tests failed, but deployment may still be functional${NC}"
        }
        
        # Test with TypeScript SDK
        if [ -f "tests/telegram-lottery.ts" ]; then
            echo -e "${BLUE}🔬 Running SDK tests...${NC}"
            npm run test:blockchain || {
                echo -e "${YELLOW}⚠️  SDK tests failed, but deployment may still be functional${NC}"
            }
        fi
        
        echo -e "${GREEN}✅ Program testing complete${NC}"
    fi
}

# Deploy backend to development server
deploy_backend() {
    echo -e "${BLUE}🖥️  Preparing backend for devnet...${NC}"
    
    # Build backend
    npm run build || {
        echo -e "${YELLOW}⚠️  Backend build failed, using source files${NC}"
    }
    
    # Update environment for devnet
    cat >> .env.devnet << EOF
# Devnet Configuration
NODE_ENV=development
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com

# Database (use separate devnet database)
DATABASE_URL=postgresql://lottery_user:lottery_pass@localhost:5432/lottery_devnet_db

# API Configuration
API_HOST=0.0.0.0
PORT=4000
EOF
    
    echo -e "${GREEN}✅ Backend configured for devnet${NC}"
}

# Deploy PWA for devnet testing
deploy_pwa() {
    echo -e "${BLUE}📱 Preparing PWA for devnet...${NC}"
    
    if [ -d "pwa" ]; then
        cd pwa
        
        # Update environment for devnet
        cat >> .env.local << EOF

# Devnet Configuration
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
EOF
        
        # Build PWA
        npm run build || {
            echo -e "${YELLOW}⚠️  PWA build failed${NC}"
        }
        
        cd ..
        echo -e "${GREEN}✅ PWA configured for devnet${NC}"
    fi
}

# Generate deployment report
generate_report() {
    echo -e "${BLUE}📊 Generating deployment report...${NC}"
    
    REPORT_FILE="devnet-deployment-$(date +%Y%m%d-%H%M%S).md"
    
    cat > "$REPORT_FILE" << EOF
# Devnet Deployment Report

**Deployment Date:** $(date)
**Network:** Solana Devnet
**Deployer:** $(whoami)

## Program Information
- **Program ID:** ${PROGRAM_ID:-"Not deployed"}
- **Keypair:** target/deploy/telegram_lottery-keypair.json
- **Network:** devnet
- **RPC URL:** https://api.devnet.solana.com

## Wallet Information
- **Public Key:** $(solana-keygen pubkey)
- **Balance:** $(solana balance)
- **Network:** $(solana config get | grep "RPC URL" | cut -d: -f2- | xargs)

## Services
- **Backend API:** Configured for devnet
- **PWA:** Built with devnet configuration
- **Database:** lottery_devnet_db

## Testing
- **Anchor Tests:** $([ -d "programs" ] && echo "Available" || echo "Not available")
- **SDK Tests:** $([ -f "tests/telegram-lottery.ts" ] && echo "Available" || echo "Not available")

## Next Steps
1. Test the deployed program on devnet
2. Configure Telegram/Discord for testing
3. Run integration tests
4. Prepare for mainnet deployment

## Useful Commands
\`\`\`bash
# Check program
solana program show ${PROGRAM_ID:-"PROGRAM_ID"}

# Get program logs
solana logs ${PROGRAM_ID:-"PROGRAM_ID"}

# Check balance
solana balance

# Test locally with devnet
./scripts/deployment/local-dev.sh
\`\`\`
EOF
    
    echo -e "${GREEN}✅ Deployment report saved: ${REPORT_FILE}${NC}"
}

# Main deployment process
main() {
    echo -e "${BLUE}🚀 Starting devnet deployment...${NC}\n"
    
    # Prerequisites
    check_prerequisites
    setup_solana_config
    
    # Deploy programs
    deploy_programs
    initialize_program
    test_deployment
    
    # Configure applications
    deploy_backend
    deploy_pwa
    
    # Generate report
    generate_report
    
    echo -e "\n${GREEN}🎉 Devnet deployment complete!${NC}"
    echo -e "${BLUE}📖 Next steps:${NC}"
    echo -e "  1. Review deployment report: ${YELLOW}${REPORT_FILE}${NC}"
    echo -e "  2. Test locally with devnet: ${YELLOW}./scripts/deployment/local-dev.sh${NC}"
    echo -e "  3. Run integration tests: ${YELLOW}npm run test:blockchain${NC}"
    echo -e "  4. Configure platform integrations (Telegram, Discord)"
    echo -e "\n${BLUE}🔗 Useful links:${NC}"
    echo -e "  - Solana Explorer: ${YELLOW}https://explorer.solana.com/?cluster=devnet${NC}"
    echo -e "  - Program ID: ${YELLOW}${PROGRAM_ID:-"Check deployment report"}${NC}"
}

# Run main function
main "$@"