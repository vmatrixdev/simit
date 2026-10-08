#!/usr/bin/env bash
# ==============================================================================
# SimIt - Extension Development Watch Script
# ==============================================================================

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}[SimIt] Starting development watch mode...${NC}"

# Ensure vendor dependencies are in place
if [ ! -d "dist/src/sandbox/vendor" ]; then
  echo -e "[SimIt] Performing initial vendor asset sync..."
  mkdir -p dist/src/sandbox/vendor
  cp -r src/sandbox/vendor/* dist/src/sandbox/vendor/
fi

echo -e "${GREEN}[SimIt] Watching for changes with Vite...${NC}"
echo -e "Tip: After code changes, click the reload icon on SimIt in chrome://extensions\n"

npx vite build --watch
