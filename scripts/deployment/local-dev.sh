#!/bin/bash

# Solana VRF Lottery PWA - Local Development
set -e

echo "🚀 Starting local development environment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if environment is set up
check_environment() {
    echo -e "${BLUE}🔍 Checking environment...${NC}"
    
    if [ ! -f ".env" ]; then
        echo -e "${RED}❌ .env file not found. Run ./scripts/setup/setup-environment.sh first${NC}"
        exit 1
    fi
    
    # Source environment variables
    source .env
    
    echo -e "${GREEN}✅ Environment loaded${NC}"
}

# Build all applications
build_applications() {
    echo -e "${BLUE}🔨 Building applications...${NC}"
    
    # Build backend
    echo -e "${BLUE}📦 Building backend...${NC}"
    npm run build || {
        echo -e "${YELLOW}⚠️  Backend build failed, continuing with TypeScript source...${NC}"
    }
    
    # Build PWA
    if [ -d "pwa" ]; then
        echo -e "${BLUE}📱 Building PWA...${NC}"
        cd pwa
        npm run build || {
            echo -e "${YELLOW}⚠️  PWA build failed, using development mode...${NC}"
        }
        cd ..
    fi
    
    # Build web dashboard
    if [ -d "web" ]; then
        echo -e "${BLUE}🌐 Building web dashboard...${NC}"
        cd web
        npm run build || {
            echo -e "${YELLOW}⚠️  Web dashboard build failed, using development mode...${NC}"
        }
        cd ..
    fi
    
    echo -e "${GREEN}✅ Applications built${NC}"
}

# Setup database
setup_database() {
    echo -e "${BLUE}🗄️  Setting up database...${NC}"
    
    # Check if database is accessible
    if ! pg_isready -h localhost -p 5432 &> /dev/null; then
        echo -e "${RED}❌ PostgreSQL not accessible. Please start PostgreSQL:${NC}"
        echo -e "  ${YELLOW}brew services start postgresql${NC} (macOS)"
        echo -e "  ${YELLOW}sudo systemctl start postgresql${NC} (Linux)"
        echo -e "  ${YELLOW}docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=lottery_pass postgres:14${NC} (Docker)"
        exit 1
    fi
    
    # Run database migrations
    if [ -f "src/database/schema.sql" ]; then
        echo -e "${BLUE}📝 Running database migrations...${NC}"
        psql $DATABASE_URL -f src/database/schema.sql || {
            echo -e "${YELLOW}⚠️  Database migration failed, continuing...${NC}"
        }
    fi
    
    echo -e "${GREEN}✅ Database ready${NC}"
}

# Start backend server
start_backend() {
    echo -e "${BLUE}🖥️  Starting backend server...${NC}"
    
    # Check if compiled version exists
    if [ -f "dist/index.js" ]; then
        npm start &
    else
        # Use development mode
        npm run dev &
    fi
    
    BACKEND_PID=$!
    echo $BACKEND_PID > tmp/backend.pid
    
    echo -e "${GREEN}✅ Backend server started (PID: $BACKEND_PID)${NC}"
}

# Start PWA
start_pwa() {
    if [ -d "pwa" ]; then
        echo -e "${BLUE}📱 Starting PWA...${NC}"
        
        cd pwa
        if [ -d ".next" ]; then
            npm start &
        else
            npm run dev &
        fi
        
        PWA_PID=$!
        echo $PWA_PID > ../tmp/pwa.pid
        cd ..
        
        echo -e "${GREEN}✅ PWA started (PID: $PWA_PID)${NC}"
    fi
}

# Start web dashboard
start_web() {
    if [ -d "web" ]; then
        echo -e "${BLUE}🌐 Starting web dashboard...${NC}"
        
        cd web
        if [ -d "build" ]; then
            npx serve -s build -l 3001 &
        else
            npm start &
        fi
        
        WEB_PID=$!
        echo $WEB_PID > ../tmp/web.pid
        cd ..
        
        echo -e "${GREEN}✅ Web dashboard started (PID: $WEB_PID)${NC}"
    fi
}

# Wait for services to be ready
wait_for_services() {
    echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
    
    # Wait for backend
    echo -e "${BLUE}🔍 Checking backend (http://localhost:4000)...${NC}"
    for i in {1..30}; do
        if curl -s http://localhost:4000/health &> /dev/null; then
            echo -e "${GREEN}✅ Backend is ready${NC}"
            break
        fi
        echo -n "."
        sleep 1
    done
    
    # Wait for PWA
    if [ -d "pwa" ]; then
        echo -e "${BLUE}🔍 Checking PWA (http://localhost:3000)...${NC}"
        for i in {1..30}; do
            if curl -s http://localhost:3000 &> /dev/null; then
                echo -e "${GREEN}✅ PWA is ready${NC}"
                break
            fi
            echo -n "."
            sleep 1
        done
    fi
    
    # Wait for web dashboard
    if [ -d "web" ]; then
        echo -e "${BLUE}🔍 Checking web dashboard (http://localhost:3001)...${NC}"
        for i in {1..30}; do
            if curl -s http://localhost:3001 &> /dev/null; then
                echo -e "${GREEN}✅ Web dashboard is ready${NC}"
                break
            fi
            echo -n "."
            sleep 1
        done
    fi
}

# Display service information
display_info() {
    echo -e "\n${GREEN}🎉 Local development environment is ready!${NC}\n"
    
    echo -e "${BLUE}📊 Services:${NC}"
    echo -e "  🖥️  Backend API:     ${YELLOW}http://localhost:4000${NC}"
    if [ -d "pwa" ]; then
        echo -e "  📱 PWA App:         ${YELLOW}http://localhost:3000${NC}"
    fi
    if [ -d "web" ]; then
        echo -e "  🌐 Admin Dashboard: ${YELLOW}http://localhost:3001${NC}"
    fi
    
    echo -e "\n${BLUE}🔗 API Endpoints:${NC}"
    echo -e "  Health Check:  ${YELLOW}http://localhost:4000/health${NC}"
    echo -e "  Auth:          ${YELLOW}http://localhost:4000/api/auth${NC}"
    echo -e "  Metrics:       ${YELLOW}http://localhost:4000/api/v1/metrics${NC}"
    
    echo -e "\n${BLUE}🛠️  Management:${NC}"
    echo -e "  Stop services: ${YELLOW}./scripts/deployment/stop-local.sh${NC}"
    echo -e "  View logs:     ${YELLOW}tail -f logs/*.log${NC}"
    echo -e "  Restart:       ${YELLOW}./scripts/deployment/restart-local.sh${NC}"
    
    echo -e "\n${YELLOW}📝 Note: Press Ctrl+C to stop all services${NC}"
}

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🛑 Stopping services...${NC}"
    
    if [ -f "tmp/backend.pid" ]; then
        kill $(cat tmp/backend.pid) 2>/dev/null || true
        rm -f tmp/backend.pid
    fi
    
    if [ -f "tmp/pwa.pid" ]; then
        kill $(cat tmp/pwa.pid) 2>/dev/null || true
        rm -f tmp/pwa.pid
    fi
    
    if [ -f "tmp/web.pid" ]; then
        kill $(cat tmp/web.pid) 2>/dev/null || true
        rm -f tmp/web.pid
    fi
    
    echo -e "${GREEN}✅ All services stopped${NC}"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Main development process
main() {
    echo -e "${BLUE}🚀 Starting local development...${NC}\n"
    
    # Setup
    check_environment
    setup_database
    build_applications
    
    # Start services
    start_backend
    sleep 2
    start_pwa
    start_web
    
    # Wait for services
    wait_for_services
    
    # Display information
    display_info
    
    # Keep script running
    while true; do
        sleep 1
    done
}

# Run main function
main "$@"