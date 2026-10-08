#!/usr/bin/env bash
# ==============================================================================
# SimIt - Developer Setup & Verification Script
# ==============================================================================

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}${BOLD}"
echo "  ____  _           ___ _   "
echo " / ___|(_)_ __ ___ |_ _| |_ "
echo " \___ \| | '_ \` _ \ | || __|"
echo "  ___) | | | | | | || || |_ "
echo " |____/|_|_| |_| |_|___|\__|"
echo -e "${NC}"
echo -e "${BOLD}SimIt: Paper & Doc Interactive Visualizer Copilot${NC}"
echo -e "Automated Environment Setup & Build Verification\n"

# 1. Check Node.js
echo -e "${CYAN}[1/4] Checking prerequisites...${NC}"
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Error: Node.js is not installed.${NC}"
  echo "Please install Node.js (v18.0.0 or later) from https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${YELLOW}Warning: Node.js version is v$NODE_VERSION. Recommended version is >= v18.0.0.${NC}"
else
  echo -e "  ✓ Node.js detected: ${GREEN}v$NODE_VERSION${NC}"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}Error: npm is not installed.${NC}"
  exit 1
fi
echo -e "  ✓ npm detected: ${GREEN}v$(npm -v)${NC}"

# 2. Install dependencies
echo -e "\n${CYAN}[2/4] Installing dependencies...${NC}"
npm install
echo -e "${GREEN}  ✓ Dependencies installed successfully.${NC}"

# 3. Build Extension Bundle
echo -e "\n${CYAN}[3/4] Building extension bundle (Vite + vendor assets)...${NC}"
npm run build
if [ -d "dist" ] && [ -f "dist/manifest.json" ]; then
  echo -e "${GREEN}  ✓ Extension build succeeded: dist/manifest.json is ready.${NC}"
else
  echo -e "${RED}Error: Build finished but dist/manifest.json was not found.${NC}"
  exit 1
fi

# 4. Run Test Suite
echo -e "\n${CYAN}[4/4] Running unit and integration test suites...${NC}"
npm test
echo -e "${GREEN}  ✓ All tests passed!${NC}"

# Next Steps
echo -e "\n${GREEN}${BOLD}================================================================${NC}"
echo -e "${GREEN}${BOLD}  SimIt setup complete! You're ready to develop.  ${NC}"
echo -e "${GREEN}${BOLD}================================================================${NC}\n"

echo -e "${BOLD}How to Load the Extension in Google Chrome:${NC}"
echo -e "  1. Open Chrome and navigate to:  ${CYAN}chrome://extensions${NC}"
echo -e "  2. Enable ${YELLOW}'Developer mode'${NC} (toggle switch in the top right corner)."
echo -e "  3. Click ${CYAN}'Load unpacked'${NC} in the top left corner."
echo -e "  4. Select the ${BOLD}dist/${NC} directory from this repository:\n     ${CYAN}$(pwd)/dist${NC}\n"

echo -e "${BOLD}Recommended Development Commands:${NC}"
echo -e "  ${CYAN}npm run dev${NC}         # Watch mode: live rebuilds on file changes"
echo -e "  ${CYAN}npm test${NC}            # Run all Vitest unit & integration tests"
echo -e "  ${CYAN}npm run test:watch${NC}  # Interactive test watch runner"
echo -e "  ${CYAN}npm run test:e2e${NC}    # Autonomous Playwright E2E browser harness"
echo -e "  ${CYAN}npm run typecheck${NC}   # Run TypeScript type check"
echo ""
