#!/bin/bash

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}🔍 Verifying Enhanced Bot Configuration...${NC}"
echo ""

# Check .env file
echo -e "${YELLOW}1. Checking .env file...${NC}"
if [ -f .env ]; then
    echo -e "${GREEN}✅ .env file exists${NC}"
    
    # Check for BOT_TOKEN
    if grep -q "BOT_TOKEN=" .env; then
        echo -e "${GREEN}✅ BOT_TOKEN is configured${NC}"
    else
        echo -e "${RED}❌ BOT_TOKEN not found in .env${NC}"
    fi
    
    # Check for ADMIN_IDS
    if grep -q "ADMIN_IDS=" .env; then
        echo -e "${GREEN}✅ ADMIN_IDS is configured${NC}"
    else
        echo -e "${YELLOW}⚠️  ADMIN_IDS not found (admin commands won't work)${NC}"
    fi
else
    echo -e "${RED}❌ .env file not found${NC}"
fi

echo ""

# Check dependencies
echo -e "${YELLOW}2. Checking dependencies...${NC}"
if [ -d node_modules ]; then
    echo -e "${GREEN}✅ node_modules exists${NC}"
    
    # Check for critical packages
    for pkg in telegraf dotenv winston; do
        if [ -d "node_modules/$pkg" ]; then
            echo -e "${GREEN}✅ $pkg installed${NC}"
        else
            echo -e "${RED}❌ $pkg not installed${NC}"
        fi
    done
else
    echo -e "${RED}❌ node_modules not found - run 'npm install'${NC}"
fi

echo ""

# Check TypeScript build
echo -e "${YELLOW}3. Checking TypeScript build...${NC}"
echo "Running build (this may take a moment)..."
if npm run build > /tmp/build-output.txt 2>&1; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed with errors:${NC}"
    tail -20 /tmp/build-output.txt
fi

echo ""

# Check if enhanced bot file exists
echo -e "${YELLOW}4. Checking enhanced bot files...${NC}"
if [ -f src/index-enhanced.ts ]; then
    echo -e "${GREEN}✅ src/index-enhanced.ts exists${NC}"
else
    echo -e "${RED}❌ src/index-enhanced.ts not found${NC}"
fi

if [ -f dist/index-enhanced.js ]; then
    echo -e "${GREEN}✅ dist/index-enhanced.js exists${NC}"
else
    echo -e "${YELLOW}⚠️  dist/index-enhanced.js not found (will be created on build)${NC}"
fi

echo ""

# Check data directory
echo -e "${YELLOW}5. Checking data directory...${NC}"
if [ -d data ]; then
    echo -e "${GREEN}✅ data directory exists${NC}"
else
    echo -e "${YELLOW}⚠️  data directory not found (will be created on startup)${NC}"
fi

echo ""
echo -e "${YELLOW}📝 Summary:${NC}"
echo "To run the enhanced bot:"
echo "1. Development mode (with hot reload): ${GREEN}./run-enhanced-dev.sh${NC}"
echo "2. Production mode: ${GREEN}./scripts/run-enhanced.sh${NC}"
echo "3. Direct development: ${GREEN}npm run dev:enhanced${NC}"
echo ""
echo "If bot doesn't respond to commands:"
echo "- Check bot token is valid"
echo "- Ensure bot has proper permissions in Telegram"
echo "- Check logs for any startup errors"
echo "- Verify ADMIN_IDS includes your Telegram user ID for admin commands"