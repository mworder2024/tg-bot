#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🎰 Starting Enhanced Lottery Bot...${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found!${NC}"
    echo "Please create a .env file with your bot configuration."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
    echo -e "${YELLOW}📁 Creating data directory...${NC}"
    mkdir -p data
fi

# Build TypeScript files
echo -e "${YELLOW}🔨 Building TypeScript files...${NC}"
npm run build

# Check if build was successful
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed! Check TypeScript errors.${NC}"
    exit 1
fi

# Start the enhanced bot
echo -e "${GREEN}🚀 Launching Enhanced Bot...${NC}"
echo -e "${GREEN}📋 Features:${NC}"
echo -e "  ✅ Advanced message queuing"
echo -e "  ✅ Dynamic game speed"
echo -e "  ✅ Suspense messages"
echo -e "  ✅ Game scheduling"
echo -e "  ✅ Admin menu (/admin)"
echo ""

# Run the enhanced bot
node dist/index-enhanced.js