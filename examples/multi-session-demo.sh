#!/bin/bash

# WAHA Multi-Session Demo Script
# This script demonstrates the new multi-session capabilities

set -e

BASE_URL="${WAHA_BASE_URL:-http://localhost:3000}"
API_KEY="${WHATSAPP_API_KEY:-}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function for API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    local headers="-H 'Content-Type: application/json'"
    if [ -n "$API_KEY" ]; then
        headers="$headers -H 'X-Api-Key: $API_KEY'"
    fi
    
    if [ -n "$data" ]; then
        eval curl -s -X "$method" "$headers" -d "'$data'" "$BASE_URL$endpoint"
    else
        eval curl -s -X "$method" "$headers" "$BASE_URL$endpoint"
    fi
}

echo -e "${BLUE}=== WAHA Multi-Session Demo ===${NC}\n"

# 1. Create multiple sessions
echo -e "${YELLOW}Step 1: Creating 3 sessions...${NC}"

echo -e "${GREEN}Creating session: sales${NC}"
api_call POST "/api/sessions" '{
  "name": "sales",
  "config": {
    "metadata": {
      "department": "sales",
      "region": "US"
    }
  }
}' | jq '.'

echo -e "\n${GREEN}Creating session: support${NC}"
api_call POST "/api/sessions" '{
  "name": "support",
  "config": {
    "metadata": {
      "department": "support",
      "region": "EU"
    }
  }
}' | jq '.'

echo -e "\n${GREEN}Creating session: marketing${NC}"
api_call POST "/api/sessions" '{
  "name": "marketing",
  "config": {
    "metadata": {
      "department": "marketing",
      "region": "APAC"
    }
  }
}' | jq '.'

# 2. List all sessions
echo -e "\n${YELLOW}Step 2: Listing all sessions...${NC}"
api_call GET "/api/sessions?all=true" | jq '.[] | {name, status, metadata: .config.metadata}'

# 3. Start a session
echo -e "\n${YELLOW}Step 3: Starting 'sales' session...${NC}"
api_call POST "/api/sessions/sales/start" | jq '.'

echo -e "${GREEN}Waiting 5 seconds for session to initialize...${NC}"
sleep 5

# 4. Check session info
echo -e "\n${YELLOW}Step 4: Getting session info...${NC}"
api_call GET "/api/sessions/sales" | jq '.'

# 5. Get session health
echo -e "\n${YELLOW}Step 5: Checking session health...${NC}"
api_call GET "/api/sessions/sales/health" | jq '.'

# 6. Get all sessions health summary
echo -e "\n${YELLOW}Step 6: Getting health summary...${NC}"
api_call GET "/api/health/summary" | jq '{total, working, stopped}'

# 7. Check workers (if worker mode enabled)
echo -e "\n${YELLOW}Step 7: Checking worker distribution...${NC}"
api_call GET "/api/workers" | jq '.'

# 8. Get Prometheus metrics
echo -e "\n${YELLOW}Step 8: Fetching Prometheus metrics...${NC}"
echo -e "${GREEN}First 10 lines of metrics:${NC}"
api_call GET "/api/metrics" | head -n 10

# 9. Stop session
echo -e "\n${YELLOW}Step 9: Stopping 'sales' session...${NC}"
api_call POST "/api/sessions/sales/stop" | jq '.'

# 10. Verify session stopped
echo -e "\n${YELLOW}Step 10: Verifying session stopped...${NC}"
api_call GET "/api/sessions/sales" | jq '{name, status}'

echo -e "\n${BLUE}=== Demo Complete! ===${NC}"
echo -e "\n${GREEN}Summary:${NC}"
echo "✅ Created 3 sessions"
echo "✅ Started and stopped a session"
echo "✅ Retrieved health metrics"
echo "✅ Checked worker distribution"
echo "✅ Accessed Prometheus metrics"

echo -e "\n${YELLOW}Next Steps:${NC}"
echo "1. Scan QR codes for each session"
echo "2. Send messages via API"
echo "3. Monitor with Prometheus/Grafana"
echo "4. Scale with multiple workers"

echo -e "\n${BLUE}Documentation:${NC}"
echo "📚 Full guide: MULTI_SESSION_UPGRADE.md"
echo "🔧 Technical details: TECHNICAL_CHANGES.md"

