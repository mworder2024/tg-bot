#!/bin/bash

# Solana VRF Lottery PWA - Restart Local Services
set -e

echo "🔄 Restarting local development environment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Stop all services first
echo -e "${BLUE}🛑 Stopping existing services...${NC}"
./scripts/deployment/stop-local.sh

# Wait a moment for cleanup
echo -e "${BLUE}⏳ Waiting for cleanup...${NC}"
sleep 3

# Start services again
echo -e "${BLUE}🚀 Starting services...${NC}"
./scripts/deployment/local-dev.sh

echo -e "${GREEN}✅ Restart complete!${NC}"