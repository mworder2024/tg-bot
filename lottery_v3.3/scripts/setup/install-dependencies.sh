#!/bin/bash

# Solana VRF Lottery PWA - Install Dependencies
set -e

echo "🚀 Installing dependencies for Solana VRF Lottery PWA..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Node.js is installed
check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js not found. Please install Node.js 18+ and try again.${NC}"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${RED}❌ Node.js version 18+ required. Current version: $(node -v)${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Node.js $(node -v) detected${NC}"
}

# Check if npm is installed
check_npm() {
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm not found. Please install npm and try again.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ npm $(npm -v) detected${NC}"
}

# Install root dependencies
install_root() {
    echo -e "${BLUE}📦 Installing root dependencies...${NC}"
    npm install --legacy-peer-deps || {
        echo -e "${YELLOW}⚠️  npm install failed, trying with --force...${NC}"
        npm install --force
    }
    echo -e "${GREEN}✅ Root dependencies installed${NC}"
}

# Install PWA dependencies
install_pwa() {
    echo -e "${BLUE}📦 Installing PWA dependencies...${NC}"
    if [ -d "pwa" ]; then
        cd pwa
        npm install || {
            echo -e "${YELLOW}⚠️  PWA npm install failed, trying with --legacy-peer-deps...${NC}"
            npm install --legacy-peer-deps
        }
        cd ..
        echo -e "${GREEN}✅ PWA dependencies installed${NC}"
    else
        echo -e "${YELLOW}⚠️  PWA directory not found, skipping...${NC}"
    fi
}

# Install web dashboard dependencies
install_web() {
    echo -e "${BLUE}📦 Installing web dashboard dependencies...${NC}"
    if [ -d "web" ]; then
        cd web
        npm install || {
            echo -e "${YELLOW}⚠️  Web npm install failed, trying with --legacy-peer-deps...${NC}"
            npm install --legacy-peer-deps
        }
        cd ..
        echo -e "${GREEN}✅ Web dashboard dependencies installed${NC}"
    else
        echo -e "${YELLOW}⚠️  Web directory not found, skipping...${NC}"
    fi
}

# Install Solana CLI
install_solana() {
    if ! command -v solana &> /dev/null; then
        echo -e "${BLUE}📦 Installing Solana CLI...${NC}"
        sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"
        export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
        echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
        echo -e "${GREEN}✅ Solana CLI installed${NC}"
    else
        echo -e "${GREEN}✅ Solana CLI $(solana --version) already installed${NC}"
    fi
}

# Install Anchor
install_anchor() {
    if ! command -v anchor &> /dev/null; then
        echo -e "${BLUE}📦 Installing Anchor CLI...${NC}"
        cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
        avm install latest
        avm use latest
        echo -e "${GREEN}✅ Anchor CLI installed${NC}"
    else
        echo -e "${GREEN}✅ Anchor CLI $(anchor --version) already installed${NC}"
    fi
}

# Main installation process
main() {
    echo -e "${BLUE}🔧 Starting dependency installation...${NC}\n"
    
    # Check prerequisites
    check_node
    check_npm
    
    # Install dependencies
    install_root
    install_pwa
    install_web
    
    # Ask about Solana tools
    echo -e "\n${YELLOW}🔗 Do you want to install Solana development tools? (y/n)${NC}"
    read -r install_blockchain
    if [[ $install_blockchain =~ ^[Yy]$ ]]; then
        install_solana
        install_anchor
    fi
    
    echo -e "\n${GREEN}🎉 All dependencies installed successfully!${NC}"
    echo -e "${BLUE}📖 Next steps:${NC}"
    echo -e "  1. Run: ${YELLOW}./scripts/setup/setup-environment.sh${NC}"
    echo -e "  2. Configure your .env files"
    echo -e "  3. Run: ${YELLOW}./scripts/deployment/local-dev.sh${NC}"
}

# Run main function
main "$@"