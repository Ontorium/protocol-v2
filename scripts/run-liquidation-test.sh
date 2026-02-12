#!/bin/bash
set -eo pipefail

# Run liquidation test cases on an Anvil fork of Arbitrum Sepolia
#
# Usage:
#   ./scripts/run-liquidation-test.sh
#   RPC_URL=https://arb-sepolia.g.alchemy.com/v2/<key> ./scripts/run-liquidation-test.sh

# ---- Config ----
ADDRESSES_PROVIDER="${ADDRESSES_PROVIDER:-0x3F7ec1b283Af544A074948028B9541332f6b08E7}"
RPC_URL="${RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
CHAIN_ID="${CHAIN_ID:-421614}"
ANVIL_PATH="${ANVIL_PATH:-$HOME/.foundry/bin/anvil}"
PORT="${PORT:-8545}"

# ---- Load .env ----
set -a
[ -f ".env" ] && source .env
set +a

: "${MNEMONIC:=test test test test test test test test test test test junk}"
export MNEMONIC

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ---- Helpers ----
cleanup() {
  echo -e "\n${YELLOW}Stopping Anvil...${NC}"
  pkill -f "anvil.*--port.*$PORT" >/dev/null 2>&1 || true
  sleep 1
}
trap cleanup EXIT

# Kill any existing anvil on this port
pkill -f "anvil.*--port.*$PORT" >/dev/null 2>&1 || true
sleep 1

# ---- Check Anvil ----
if [ ! -x "$ANVIL_PATH" ]; then
  echo -e "${RED}Anvil not found at: $ANVIL_PATH${NC}"
  echo -e "${RED}Install foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup${NC}"
  exit 1
fi

# ---- Get fork block ----
if [ -z "${FORK_BLOCK:-}" ]; then
  if command -v cast >/dev/null 2>&1; then
    FORK_BLOCK=$(cast block-number --rpc-url "$RPC_URL" 2>/dev/null || echo "")
  fi
  if [ -z "$FORK_BLOCK" ]; then
    FORK_BLOCK=$(curl -s -X POST "$RPC_URL" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      | grep -o '"result":"[^"]*"' | cut -d'"' -f4 | xargs printf "%d" 2>/dev/null || echo "")
  fi
fi

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  Liquidation Test (Anvil Fork)${NC}"
echo -e "${GREEN}=====================================${NC}"
echo -e "${YELLOW}RPC:    $RPC_URL${NC}"
echo -e "${YELLOW}Block:  ${FORK_BLOCK:-latest}${NC}"
echo -e "${YELLOW}Port:   $PORT${NC}"
echo ""

# ---- Start Anvil ----
echo -e "${YELLOW}Starting Anvil fork...${NC}"

FORK_ARGS=(
  --fork-url "$RPC_URL"
  --port "$PORT"
  --chain-id "$CHAIN_ID"
  --mnemonic "$MNEMONIC"
  --accounts 20
  --balance 1000000
)

if [ -n "${FORK_BLOCK:-}" ]; then
  FORK_ARGS+=(--fork-block-number "$FORK_BLOCK")
fi

"$ANVIL_PATH" "${FORK_ARGS[@]}" &
ANVIL_PID=$!

# Wait for Anvil to be ready
retries=15
while [ $retries -gt 0 ]; do
  if curl -s "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  retries=$((retries - 1))
done

if ! curl -s "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
  echo -e "${RED}Failed to start Anvil on :$PORT${NC}"
  exit 1
fi

echo -e "${GREEN}Anvil running (pid: $ANVIL_PID)${NC}"
echo ""

# ---- Run script ----
echo -e "${YELLOW}Running liquidation test script...${NC}"
echo ""

USE_DEPLOYED="$ADDRESSES_PROVIDER" \
  MNEMONIC="$MNEMONIC" \
  HARDHAT_NETWORK_URL="http://127.0.0.1:$PORT" \
  npx hardhat run scripts/test-liquidation-cases.ts --network localhost

echo ""
echo -e "${GREEN}Done. Report: scripts/liquidation-report-*.md${NC}"
