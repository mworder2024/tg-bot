#!/bin/bash

# Solana VRF Lottery PWA - Environment Setup
set -e

echo "🔧 Setting up development environment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Generate random secrets
generate_secret() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

# Create environment files
create_env_files() {
    echo -e "${BLUE}📝 Creating environment files...${NC}"
    
    # Root .env
    if [ ! -f ".env" ]; then
        cat > .env << EOF
# Database Configuration
DATABASE_URL=postgresql://lottery_user:lottery_pass@localhost:5432/lottery_db
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=$(generate_secret)

# Solana Configuration
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=11111111111111111111111111111111
SOLANA_WALLET_PRIVATE_KEY=

# Platform Integration
TELEGRAM_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

# VRF Configuration
ORAO_VRF_PROGRAM_ID=VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y

# API Configuration
PORT=4000
API_HOST=localhost
API_CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# Monitoring
SENTRY_DSN=
LOG_LEVEL=info

# Development
NODE_ENV=development
EOF
        echo -e "${GREEN}✅ Created .env file${NC}"
    else
        echo -e "${YELLOW}⚠️  .env file already exists, skipping...${NC}"
    fi
    
    # PWA .env.local
    if [ ! -f "pwa/.env.local" ] && [ -d "pwa" ]; then
        cat > pwa/.env.local << EOF
# Next.js Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000

# Solana Configuration
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=11111111111111111111111111111111

# Platform Integration
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=
NEXT_PUBLIC_DISCORD_CLIENT_ID=

# Environment
NODE_ENV=development
EOF
        echo -e "${GREEN}✅ Created pwa/.env.local file${NC}"
    fi
    
    # Web dashboard .env.local
    if [ ! -f "web/.env.local" ] && [ -d "web" ]; then
        cat > web/.env.local << EOF
# React Configuration
REACT_APP_API_URL=http://localhost:4000
REACT_APP_WS_URL=ws://localhost:4000

# Authentication
REACT_APP_JWT_STORAGE_KEY=admin_token

# Environment
NODE_ENV=development
EOF
        echo -e "${GREEN}✅ Created web/.env.local file${NC}"
    fi
}

# Setup Solana keypair
setup_solana_keypair() {
    echo -e "${BLUE}🔑 Setting up Solana keypair...${NC}"
    
    if [ ! -f "$HOME/.config/solana/id.json" ]; then
        echo -e "${YELLOW}📝 Generating new Solana keypair...${NC}"
        solana-keygen new --no-bip39-passphrase
    fi
    
    # Set Solana config to devnet
    solana config set --url devnet
    
    # Get public key
    PUBLIC_KEY=$(solana-keygen pubkey)
    echo -e "${GREEN}✅ Solana keypair ready: ${PUBLIC_KEY}${NC}"
    
    # Request airdrop for devnet
    echo -e "${BLUE}💰 Requesting devnet airdrop...${NC}"
    solana airdrop 2 || echo -e "${YELLOW}⚠️  Airdrop failed, you may need to request manually${NC}"
}

# Setup database
setup_database() {
    echo -e "${BLUE}🗄️  Setting up PostgreSQL database...${NC}"
    
    # Check if PostgreSQL is running
    if ! pg_isready -h localhost -p 5432 &> /dev/null; then
        echo -e "${YELLOW}⚠️  PostgreSQL not running. Please start PostgreSQL and run this script again.${NC}"
        echo -e "${BLUE}📖 To start PostgreSQL:${NC}"
        echo -e "  - macOS: ${YELLOW}brew services start postgresql${NC}"
        echo -e "  - Linux: ${YELLOW}sudo systemctl start postgresql${NC}"
        echo -e "  - Docker: ${YELLOW}docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=lottery_pass postgres:14${NC}"
        return 1
    fi
    
    # Create database and user
    echo -e "${BLUE}📝 Creating database and user...${NC}"
    sudo -u postgres psql << EOF || {
        echo -e "${YELLOW}⚠️  Database creation failed. You may need to create manually:${NC}"
        echo -e "  ${YELLOW}createdb lottery_db${NC}"
        echo -e "  ${YELLOW}createuser lottery_user${NC}"
        return 1
    }
CREATE DATABASE lottery_db;
CREATE USER lottery_user WITH PASSWORD 'lottery_pass';
GRANT ALL PRIVILEGES ON DATABASE lottery_db TO lottery_user;
\q
EOF
    
    echo -e "${GREEN}✅ Database setup complete${NC}"
}

# Setup Redis
setup_redis() {
    echo -e "${BLUE}🔴 Setting up Redis...${NC}"
    
    # Check if Redis is running
    if ! redis-cli ping &> /dev/null; then
        echo -e "${YELLOW}⚠️  Redis not running. Please start Redis and run this script again.${NC}"
        echo -e "${BLUE}📖 To start Redis:${NC}"
        echo -e "  - macOS: ${YELLOW}brew services start redis${NC}"
        echo -e "  - Linux: ${YELLOW}sudo systemctl start redis${NC}"
        echo -e "  - Docker: ${YELLOW}docker run -d -p 6379:6379 redis:7${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Redis is running${NC}"
}

# Create directory structure
create_directories() {
    echo -e "${BLUE}📁 Creating directory structure...${NC}"
    
    mkdir -p logs
    mkdir -p data/uploads
    mkdir -p data/backups
    mkdir -p tmp
    
    echo -e "${GREEN}✅ Directory structure created${NC}"
}

# Main setup process
main() {
    echo -e "${BLUE}🔧 Starting environment setup...${NC}\n"
    
    # Create environment files
    create_env_files
    
    # Create directories
    create_directories
    
    # Ask about services setup
    echo -e "\n${YELLOW}🗄️  Do you want to set up database and Redis? (requires PostgreSQL and Redis installed) (y/n)${NC}"
    read -r setup_services
    if [[ $setup_services =~ ^[Yy]$ ]]; then
        setup_database
        setup_redis
    fi
    
    # Ask about Solana setup
    echo -e "\n${YELLOW}🔗 Do you want to set up Solana keypair and devnet? (y/n)${NC}"
    read -r setup_solana
    if [[ $setup_solana =~ ^[Yy]$ ]]; then
        setup_solana_keypair
    fi
    
    echo -e "\n${GREEN}🎉 Environment setup complete!${NC}"
    echo -e "${BLUE}📖 Next steps:${NC}"
    echo -e "  1. Edit .env files with your platform tokens"
    echo -e "  2. Run: ${YELLOW}./scripts/deployment/local-dev.sh${NC}"
    echo -e "\n${YELLOW}📝 Important:${NC}"
    echo -e "  - Add your TELEGRAM_BOT_TOKEN to .env"
    echo -e "  - Add your DISCORD_CLIENT_ID to .env"
    echo -e "  - Update SOLANA_PROGRAM_ID after deployment"
}

# Run main function
main "$@"