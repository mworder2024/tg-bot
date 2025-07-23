#!/bin/bash

# Lottery Bot Stress Testing Script
# This script runs comprehensive stress tests on the lottery bot

echo "🚀 Lottery Bot Stress Testing Suite"
echo "==================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if required dependencies are installed
check_dependencies() {
    echo "📋 Checking dependencies..."
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js is not installed${NC}"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm is not installed${NC}"
        exit 1
    fi
    
    # Install required packages if not present
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}📦 Installing dependencies...${NC}"
        npm install axios dotenv
    fi
    
    echo -e "${GREEN}✅ All dependencies satisfied${NC}"
    echo ""
}

# Run API stress test
run_api_stress_test() {
    echo -e "${YELLOW}🔥 Running API Stress Test${NC}"
    echo "=========================="
    
    # Set test parameters
    export API_URL="${API_URL:-http://localhost:3001}"
    export CONCURRENT_USERS="${CONCURRENT_USERS:-50}"
    export TEST_DURATION="${TEST_DURATION:-30000}"
    
    node tests/stress-test.js
    
    echo ""
}

# Run Telegram bot stress test
run_telegram_stress_test() {
    echo -e "${YELLOW}🤖 Running Telegram Bot Stress Test${NC}"
    echo "==================================="
    
    # Check if bot token is set
    if [ -z "$BOT_TOKEN" ]; then
        echo -e "${YELLOW}⚠️  BOT_TOKEN not set, running in simulation mode${NC}"
    fi
    
    export TEST_WEBHOOK="${TEST_WEBHOOK:-false}"
    
    node tests/telegram-bot-stress-test.js
    
    echo ""
}

# Monitor system resources
monitor_resources() {
    echo -e "${YELLOW}📊 Monitoring System Resources${NC}"
    echo "=============================="
    
    # Function to get system stats
    get_stats() {
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # Linux
            echo "CPU Usage: $(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1"%"}')"
            echo "Memory: $(free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2}')"
            echo "Load Average: $(uptime | awk -F'load average:' '{print $2}')"
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            echo "CPU Usage: $(ps -A -o %cpu | awk '{s+=$1} END {print s "%"}')"
            echo "Memory: $(ps aux | awk '{sum+=$4} END {print sum "%"}')"
            echo "Load Average: $(uptime | awk -F'load averages:' '{print $2}')"
        fi
    }
    
    # Monitor for 30 seconds
    for i in {1..6}; do
        get_stats
        echo "---"
        sleep 5
    done
    
    echo ""
}

# Generate test report
generate_report() {
    echo -e "${YELLOW}📄 Generating Test Report${NC}"
    echo "========================"
    
    REPORT_FILE="stress-test-report-$(date +%Y%m%d-%H%M%S).txt"
    
    cat > "$REPORT_FILE" << EOF
Lottery Bot Stress Test Report
Generated: $(date)
================================

Test Configuration:
- API URL: ${API_URL:-http://localhost:3001}
- Concurrent Users: ${CONCURRENT_USERS:-50}
- Test Duration: ${TEST_DURATION:-30000}ms

Test Results:
(See console output above for detailed results)

Recommendations:
1. If success rate < 95%, consider:
   - Increasing database connection pool size
   - Implementing better caching strategies
   - Optimizing database queries

2. If response times > 1000ms:
   - Review API endpoint performance
   - Consider adding indices to database
   - Implement response caching

3. If rate limiting is too aggressive:
   - Adjust rate limit thresholds
   - Implement tiered rate limiting

System Information:
- Node Version: $(node --version)
- Platform: $(uname -s)
- Architecture: $(uname -m)
- CPU Cores: $(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "Unknown")

EOF
    
    echo -e "${GREEN}✅ Report saved to: $REPORT_FILE${NC}"
    echo ""
}

# Main menu
show_menu() {
    echo "Select test to run:"
    echo "1) Full Stress Test Suite"
    echo "2) API Stress Test Only"
    echo "3) Telegram Bot Stress Test Only"
    echo "4) Monitor Resources Only"
    echo "5) Exit"
    echo ""
    read -p "Enter choice [1-5]: " choice
    
    case $choice in
        1)
            check_dependencies
            monitor_resources &
            MONITOR_PID=$!
            run_api_stress_test
            run_telegram_stress_test
            kill $MONITOR_PID 2>/dev/null
            generate_report
            ;;
        2)
            check_dependencies
            run_api_stress_test
            ;;
        3)
            check_dependencies
            run_telegram_stress_test
            ;;
        4)
            monitor_resources
            ;;
        5)
            echo "Exiting..."
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid choice. Please try again.${NC}"
            show_menu
            ;;
    esac
}

# Quick test mode for CI/CD
if [ "$1" == "--quick" ]; then
    echo "Running quick stress test..."
    export CONCURRENT_USERS=25
    export TEST_DURATION=10000
    check_dependencies
    run_api_stress_test
    exit 0
fi

# Help message
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    cat << EOF
Usage: ./run-stress-test.sh [OPTIONS]

Options:
  --quick         Run a quick stress test (25 users, 10s)
  --help, -h      Show this help message

Environment Variables:
  API_URL              API server URL (default: http://localhost:3001)
  CONCURRENT_USERS     Number of concurrent users (default: 50)
  TEST_DURATION        Test duration in ms (default: 30000)
  BOT_TOKEN           Telegram bot token for live testing
  TEST_WEBHOOK        Set to 'true' to test webhook mode

Examples:
  # Run with custom settings
  API_URL=https://api.example.com CONCURRENT_USERS=100 ./run-stress-test.sh
  
  # Quick test for CI/CD
  ./run-stress-test.sh --quick
  
  # Test with webhook mode
  TEST_WEBHOOK=true ./run-stress-test.sh

EOF
    exit 0
fi

# Show banner
cat << "EOF"
   _     ___ _____ _____ _____ ______   __  ____   ___ _____ 
  | |   / _ \_   _|_   _| ____|  _ \ \ / / | __ ) / _ \_   _|
  | |  | | | || |   | | |  _| | |_) \ V /  |  _ \| | | || |  
  | |__| |_| || |   | | | |___|  _ < | |   | |_) | |_| || |  
  |_____\___/ |_|   |_| |_____|_| \_\|_|   |____/ \___/ |_|  
                                                              
        ____  _____ ____  _____ ____ ____    _____ _____ ____ _____ 
       / ___||_   _|  _ \| ____/ ___/ ___|  |_   _| ____/ ___|_   _|
       \___ \  | | | |_) |  _| \___ \___ \    | | |  _| \___ \ | |  
        ___) | | | |  _ <| |___ ___) |__) |   | | | |___ ___) || |  
       |____/  |_| |_| \_\_____|____/____/    |_| |_____|____/ |_|  

EOF

# Run menu
show_menu