#!/bin/bash

# Solana VRF Lottery PWA - Stop Local Services
set -e

echo "🛑 Stopping local development services..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Stop services by PID files
stop_by_pid() {
    local service_name=$1
    local pid_file=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "${BLUE}🛑 Stopping ${service_name} (PID: ${pid})...${NC}"
            kill "$pid"
            rm -f "$pid_file"
            echo -e "${GREEN}✅ ${service_name} stopped${NC}"
        else
            echo -e "${YELLOW}⚠️  ${service_name} not running (stale PID file)${NC}"
            rm -f "$pid_file"
        fi
    else
        echo -e "${YELLOW}⚠️  ${service_name} PID file not found${NC}"
    fi
}

# Stop services by port
stop_by_port() {
    local service_name=$1
    local port=$2
    
    local pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo -e "${BLUE}🛑 Stopping ${service_name} on port ${port} (PID: ${pid})...${NC}"
        kill "$pid" 2>/dev/null || true
        echo -e "${GREEN}✅ ${service_name} stopped${NC}"
    else
        echo -e "${YELLOW}⚠️  No service running on port ${port}${NC}"
    fi
}

# Stop all Node.js processes related to the project
stop_node_processes() {
    echo -e "${BLUE}🔍 Looking for project-related Node.js processes...${NC}"
    
    # Get current directory name for process matching
    local project_dir=$(basename "$(pwd)")
    
    # Find Node.js processes that might be related to this project
    local pids=$(ps aux | grep -E "(node|npm|next|react-scripts)" | grep -v grep | awk '{print $2}' || true)
    
    if [ -n "$pids" ]; then
        echo -e "${BLUE}📋 Found Node.js processes:${NC}"
        ps aux | grep -E "(node|npm|next|react-scripts)" | grep -v grep | head -10
        
        echo -e "\n${YELLOW}🤔 Stop all Node.js processes? (y/n)${NC}"
        read -r stop_all
        if [[ $stop_all =~ ^[Yy]$ ]]; then
            echo "$pids" | xargs kill 2>/dev/null || true
            echo -e "${GREEN}✅ Node.js processes stopped${NC}"
        fi
    else
        echo -e "${GREEN}✅ No Node.js processes found${NC}"
    fi
}

# Main stop process
main() {
    echo -e "${BLUE}🛑 Stopping all local services...${NC}\n"
    
    # Create tmp directory if it doesn't exist
    mkdir -p tmp
    
    # Stop services by PID files
    stop_by_pid "Backend" "tmp/backend.pid"
    stop_by_pid "PWA" "tmp/pwa.pid"
    stop_by_pid "Web Dashboard" "tmp/web.pid"
    
    echo -e "\n${BLUE}🔍 Checking for services on common ports...${NC}"
    
    # Stop services by common ports
    stop_by_port "Backend API" 4000
    stop_by_port "PWA" 3000
    stop_by_port "Web Dashboard" 3001
    stop_by_port "GraphQL Playground" 4000
    
    # Additional port cleanup
    local additional_ports=(8080 8000 5000 3002 3003)
    for port in "${additional_ports[@]}"; do
        stop_by_port "Service" "$port"
    done
    
    echo -e "\n${BLUE}🧹 Cleaning up temporary files...${NC}"
    
    # Clean up PID files
    rm -f tmp/*.pid
    
    # Clean up log files (optional)
    echo -e "${YELLOW}🗑️  Clean up log files? (y/n)${NC}"
    read -r clean_logs
    if [[ $clean_logs =~ ^[Yy]$ ]]; then
        rm -f logs/*.log
        echo -e "${GREEN}✅ Log files cleaned${NC}"
    fi
    
    # Check for any remaining Node.js processes
    stop_node_processes
    
    echo -e "\n${GREEN}🎉 All services stopped!${NC}"
    echo -e "${BLUE}📖 To restart:${NC}"
    echo -e "  ${YELLOW}./scripts/deployment/local-dev.sh${NC}"
}

# Run main function
main "$@"