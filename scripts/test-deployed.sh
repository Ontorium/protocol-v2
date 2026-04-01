#!/bin/bash
set -eo pipefail

# Fork-deployed contracts test runner (Anvil fork + Hardhat tests)
#
# ✅ Each spec runs in an isolated environment:
#   For every spec:
#     1) start a fresh Anvil fork
#     2) run __setup.spec.ts + that spec
#     3) kill Anvil
#
# ✅ This version:
#   - continues even if some specs fail
#   - prints which spec is running
#   - summarizes failures and exits non-zero if any failed
#
# Usage:
#   ./scripts/test-deployed.sh
#   ./scripts/test-deployed.sh test-suites/test-custom/flashloan.spec.ts
#   ./scripts/test-deployed.sh test-suites/test-custom
#   ./scripts/test-deployed.sh "test-suites/test-custom/**/*.spec.ts"

# ---- Node / nvm ----
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

if command -v nvm >/dev/null 2>&1; then
  nvm use 18 >/dev/null 2>&1 || {
    echo "WARN: nvm use 18 failed. current node: $(node -v 2>/dev/null || echo unknown)"
  }
else
  echo "WARN: nvm not found. current node: $(node -v 2>/dev/null || echo unknown)"
fi

# ---- Config ----
ADDRESSES_PROVIDER="${ADDRESSES_PROVIDER:-0x3F7ec1b283Af544A074948028B9541332f6b08E7}"
RPC_URL="${RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
CHAIN_ID="${CHAIN_ID:-421614}"
ANVIL_PATH="${ANVIL_PATH:-$HOME/.foundry/bin/anvil}"
PARALLEL="${PARALLEL:-false}"
MAX_PARALLEL="${MAX_PARALLEL:-4}"
BASE_PORT="${BASE_PORT:-8545}"

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---- Load .env (export all vars) ----
set -a
if [ -f ".env" ]; then
  # shellcheck disable=SC1091
  source .env
fi
set +a

: "${MNEMONIC:=test test test test test test test test test test test junk}"
export MNEMONIC

# ---- Get fixed block number for consistent fork ----
get_fork_block() {
  if [ -n "${FORK_BLOCK:-}" ]; then
    echo "$FORK_BLOCK"
    return
  fi
  if command -v cast >/dev/null 2>&1; then
    FORK_BLOCK=$(cast block-number --rpc-url "$RPC_URL" 2>/dev/null || echo "")
  fi
  if [ -z "$FORK_BLOCK" ]; then
    FORK_BLOCK=$(curl -s -X POST "$RPC_URL" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      | grep -o '"result":"[^"]*"' | cut -d'"' -f4 | xargs printf "%d" 2>/dev/null || echo "")
  fi
  echo "$FORK_BLOCK"
}

FORK_BLOCK=$(get_fork_block)
export FORK_BLOCK
echo -e "${YELLOW}Using fixed fork block: $FORK_BLOCK${NC}"

# ---- Helpers ----
kill_anvil() {
  pkill -f "anvil.*$CHAIN_ID" >/dev/null 2>&1 || true
  pkill -f "anvil.*8545" >/dev/null 2>&1 || true
  sleep 1
}

kill_anvil_port() {
  local port="$1"
  pkill -f "anvil.*--port.*$port" >/dev/null 2>&1 || true
  # Wait and ensure port is free before returning
  local max_wait=10
  local waited=0
  while lsof -i:"$port" >/dev/null 2>&1 && [ $waited -lt $max_wait ]; do
    sleep 1
    waited=$((waited + 1))
  done
  # Additional wait to ensure clean state
  sleep 1
}

start_anvil() {
  local port="${1:-8545}"

  kill_anvil_port "$port"
  echo -e "${YELLOW}Starting Anvil fork on port $port...${NC}"

  if [ ! -x "$ANVIL_PATH" ]; then
    echo -e "${RED}Anvil not found at: $ANVIL_PATH${NC}"
    echo -e "${RED}Set ANVIL_PATH or install foundry/anvil.${NC}"
    exit 1
  fi

  local fork_args=(
    --fork-url "$RPC_URL"
    --port "$port"
    --chain-id "$CHAIN_ID"
    --mnemonic "$MNEMONIC"
    --accounts 20
    --balance 1000000
    --silent
  )

  if [ -n "${FORK_BLOCK:-}" ]; then
    fork_args+=(--fork-block-number "$FORK_BLOCK")
  fi

  "$ANVIL_PATH" "${fork_args[@]}" >/dev/null 2>&1 &

  sleep 3

  # Wait longer and retry
  local retries=10
  while [ $retries -gt 0 ]; do
    if curl -s "http://127.0.0.1:$port" >/dev/null 2>&1; then
      break
    fi
    sleep 1
    retries=$((retries - 1))
  done

  if ! curl -s "http://127.0.0.1:$port" >/dev/null 2>&1; then
    echo -e "${RED}Failed to start Anvil on :$port${NC}"
    return 1
  fi

  echo -e "${GREEN}Anvil started on port $port${NC}"

  if [ "$port" = "8545" ] && command -v cast >/dev/null 2>&1; then
    echo -e "${YELLOW}mnemonic[0]=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 0)${NC}"
    echo -e "${YELLOW}mnemonic[1]=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 1)${NC}"
    echo -e "${YELLOW}rpc eth_accounts:${NC}"
    cast rpc eth_accounts --rpc-url "http://127.0.0.1:$port" || true
  fi
}

expand_target() {
  local target="$1"

  if [ -d "$target" ]; then
    find "$target" -type f -name "*.spec.ts" ! -name "__setup.spec.ts" | sort
    return 0
  fi

  if [ -f "$target" ]; then
    [ "$(basename "$target")" = "__setup.spec.ts" ] && return 0
    printf '%s\n' "$target"
    return 0
  fi

  if echo "$target" | grep -q '/\*\*/'; then
    local base rest
    base="$(echo "$target" | sed 's#/\*\*/.*$##')"
    rest="$(echo "$target" | sed 's#^.*#' | sed 's#^'"$base"'/\*\*/##')"

    [ -z "$base" ] && base="."
    if [ -d "$base" ]; then
      find "$base" -type f -path "*/$rest" ! -name "__setup.spec.ts" | sort
    fi
    return 0
  fi

  if echo "$target" | grep -q '\*\*'; then
    find . -type f -path "*/$target" ! -name "__setup.spec.ts" | sort
    return 0
  fi

  local m
  for m in $(compgen -G "$target" 2>/dev/null || true); do
    [ -f "$m" ] || continue
    [ "$(basename "$m")" = "__setup.spec.ts" ] && continue
    printf '%s\n' "$m"
  done
}

specs=()

collect_specs() {
  specs=()

  if [ $# -eq 0 ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && specs+=("$f")
    done < <(find test-suites/test-custom -type f -name "*.spec.ts" ! -name "__setup.spec.ts" | sort)
  else
    local arg
    for arg in "$@"; do
      while IFS= read -r f; do
        [ -n "$f" ] && specs+=("$f")
      done < <(expand_target "$arg")
    done
  fi

  if [ "${#specs[@]}" -eq 0 ]; then
    echo -e "${RED}No test specs found (excluding __setup.spec.ts).${NC}"
    exit 1
  fi
}

failures=()

run_one_spec() {
  local setup="test-suites/test-custom/__setup.spec.ts"
  local spec="$1"
  local idx="$2"
  local total="$3"
  local port="${4:-8545}"

  echo ""
  echo -e "${CYAN}====================================================${NC}"
  echo -e "${CYAN}  [${idx}/${total}] Running spec in fresh fork (port $port)${NC}"
  echo -e "${CYAN}  SETUP: ${setup}${NC}"
  echo -e "${CYAN}  SPEC : ${spec}${NC}"
  echo -e "${CYAN}====================================================${NC}"
  echo -e "${YELLOW}Using AddressesProvider: $ADDRESSES_PROVIDER${NC}"
  echo -e "${YELLOW}Using CHAIN_ID: $CHAIN_ID${NC}"
  echo -e "${YELLOW}Using RPC_URL: $RPC_URL${NC}"
  echo -e "${YELLOW}Using FORK_BLOCK: $FORK_BLOCK${NC}"
  echo ""

  start_anvil "$port"

  # IMPORTANT: don't exit script on a single spec failure.
  # With `if ...; then` pattern, `set -e` won't kill the script.
  if USE_DEPLOYED="$ADDRESSES_PROVIDER" \
     MNEMONIC="$MNEMONIC" \
     HARDHAT_NETWORK_URL="http://127.0.0.1:$port" \
     npx hardhat test "$setup" "$spec" --network localhost; then
    echo -e "${GREEN}✅ PASS${NC}  ${spec}"
    kill_anvil_port "$port"
    return 0
  else
    echo -e "${RED}❌ FAIL${NC}  ${spec}"
    failures+=("$spec")
    kill_anvil_port "$port"
    return 1
  fi
}

run_one_spec_standalone() {
  # Standalone runner for parallel execution (called via xargs/parallel)
  local spec="$1"
  local idx="$2"
  local total="$3"
  local port="$4"

  local setup="test-suites/test-custom/__setup.spec.ts"

  echo ""
  echo "===================================================="
  echo "  [${idx}/${total}] Running spec in fresh fork (port $port)"
  echo "  SETUP: ${setup}"
  echo "  SPEC : ${spec}"
  echo "===================================================="
  echo "Using AddressesProvider: $ADDRESSES_PROVIDER"
  echo "Using FORK_BLOCK: $FORK_BLOCK"
  echo ""

  # Kill any existing anvil on this port
  pkill -f "anvil.*--port.*$port" >/dev/null 2>&1 || true
  sleep 1

  # Start anvil
  local fork_args=(
    --fork-url "$RPC_URL"
    --port "$port"
    --chain-id "$CHAIN_ID"
    --mnemonic "$MNEMONIC"
    --accounts 20
    --balance 1000000
    --silent
  )
  if [ -n "${FORK_BLOCK:-}" ]; then
    fork_args+=(--fork-block-number "$FORK_BLOCK")
  fi

  "$ANVIL_PATH" "${fork_args[@]}" &
  local anvil_pid=$!

  # Wait for anvil to be ready
  local retries=15
  while [ $retries -gt 0 ]; do
    if curl -s "http://127.0.0.1:$port" >/dev/null 2>&1; then
      break
    fi
    sleep 1
    retries=$((retries - 1))
  done

  if ! curl -s "http://127.0.0.1:$port" >/dev/null 2>&1; then
    echo "FAIL: Could not start Anvil on port $port"
    kill $anvil_pid 2>/dev/null || true
    echo "$spec:1"
    return 1
  fi

  echo "Anvil started on port $port (pid: $anvil_pid)"

  # Run test
  local result=0
  if USE_DEPLOYED="$ADDRESSES_PROVIDER" \
     MNEMONIC="$MNEMONIC" \
     HARDHAT_NETWORK_URL="http://127.0.0.1:$port" \
     npx hardhat test "$setup" "$spec" --network localhost; then
    echo "✅ PASS  ${spec}"
    result=0
  else
    echo "❌ FAIL  ${spec}"
    result=1
  fi

  # Cleanup
  kill $anvil_pid 2>/dev/null || true
  pkill -f "anvil.*--port.*$port" >/dev/null 2>&1 || true

  echo "$spec:$result"
  return $result
}

run_test() {
  collect_specs "$@"

  echo ""
  echo -e "${GREEN}=====================================${NC}"
  echo -e "${GREEN}  Test Deployed Contracts (Isolated per Spec)${NC}"
  echo -e "${GREEN}  Network: Arbitrum Sepolia (fork)${NC}"
  echo -e "${GREEN}=====================================${NC}"
  echo -e "${YELLOW}Using AddressesProvider: $ADDRESSES_PROVIDER${NC}"
  echo -e "${YELLOW}Using CHAIN_ID: $CHAIN_ID${NC}"
  echo -e "${YELLOW}Using RPC_URL: $RPC_URL${NC}"
  echo -e "${YELLOW}Spec count (excluding setup): ${#specs[@]}${NC}"
  echo ""

  echo -e "${YELLOW}Resolved specs:${NC}"
  local s
  for s in "${specs[@]}"; do
    echo "  - $s"
  done

  local i=1
  local total="${#specs[@]}"

  if [ "$PARALLEL" = "true" ] && [ "$total" -gt 1 ]; then
    echo -e "${YELLOW}Running tests in parallel (max $MAX_PARALLEL)...${NC}"

    # Create temp dir for results
    local results_dir=$(mktemp -d)
    local jobs_file=$(mktemp)

    # Generate jobs file
    for s in "${specs[@]}"; do
      local port=$((BASE_PORT + i - 1))
      echo "$s $i $total $port" >> "$jobs_file"
      i=$((i + 1))
    done

    # Export necessary vars and functions
    export ADDRESSES_PROVIDER MNEMONIC RPC_URL CHAIN_ID ANVIL_PATH FORK_BLOCK results_dir
    export -f run_one_spec_standalone 2>/dev/null || true

    # Run with xargs (works on macOS and Linux)
    cat "$jobs_file" | while read spec idx tot port; do
      (
        result_file="$results_dir/result_${idx}"
        if run_one_spec_standalone "$spec" "$idx" "$tot" "$port" > "$results_dir/log_${idx}.txt" 2>&1; then
          echo "0" > "$result_file"
        else
          echo "1" > "$result_file"
        fi
        echo "$spec" >> "$result_file"
      ) &

      # Limit parallel jobs
      while [ $(jobs -r | wc -l) -ge "$MAX_PARALLEL" ]; do
        sleep 1
      done
    done

    # Wait for all background jobs
    wait

    # Collect results
    for logfile in "$results_dir"/log_*.txt; do
      [ -f "$logfile" ] && cat "$logfile"
    done

    for result_file in "$results_dir"/result_*; do
      if [ -f "$result_file" ]; then
        local res=$(head -1 "$result_file")
        local spec_name=$(tail -1 "$result_file")
        if [ "$res" != "0" ]; then
          failures+=("$spec_name")
        fi
      fi
    done

    rm -rf "$results_dir" "$jobs_file"
  else
    for s in "${specs[@]}"; do
      run_one_spec "$s" "$i" "$total" || true
      i=$((i + 1))
    done
  fi

  echo ""
  echo -e "${GREEN}================ Summary ================${NC}"
  if [ "${#failures[@]}" -eq 0 ]; then
    echo -e "${GREEN}All specs passed.${NC}"
    return 0
  else
    echo -e "${RED}Failed specs (${#failures[@]}):${NC}"
    local f
    for f in "${failures[@]}"; do
      echo -e "${RED}  - $f${NC}"
    done
    return 1
  fi
}

cleanup() {
  kill_anvil
  # Kill any anvil on ports 8545-8560
  for p in $(seq 8545 8560); do
    pkill -f "anvil.*--port.*$p" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

run_test "$@"
