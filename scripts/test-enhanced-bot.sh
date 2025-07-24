#!/bin/bash

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🎰 Testing Enhanced Lottery Bot...${NC}"
echo ""

# First verify configuration
echo -e "${YELLOW}Step 1: Verifying configuration...${NC}"
./verify-bot.sh

echo ""
echo -e "${YELLOW}Step 2: Starting bot in development mode...${NC}"
echo -e "${GREEN}The bot will start and display logs here.${NC}"
echo -e "${GREEN}Try these commands in your Telegram chat:${NC}"
echo ""
echo -e "  ${YELLOW}/startlottery${NC} - Start a new lottery game"
echo -e "  ${YELLOW}/join${NC} - Join the active game"
echo -e "  ${YELLOW}/admin${NC} - Open admin menu (admin only)"
echo -e "  ${YELLOW}/schedule${NC} - Set up recurring games"
echo -e "  ${YELLOW}/help${NC} - Show all commands"
echo ""
echo -e "${GREEN}Press Ctrl+C to stop the bot${NC}"
echo ""

# Start the bot
npm run dev:enhanced