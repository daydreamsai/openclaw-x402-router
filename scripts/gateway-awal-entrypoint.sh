#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:1
export AWAL_HOME="${AWAL_HOME:-/home/node}"
export XDG_CONFIG_HOME="${AWAL_HOME}/.config"
export XDG_CACHE_HOME="${AWAL_HOME}/.cache"

AWAL_DIR="${AWAL_HOME}/.local/share/awal/server"
AWAL_LOG="/tmp/awal-electron.log"
AWAL_INIT_TIMEOUT="${AWAL_INIT_TIMEOUT:-15}"

# SAW paths — running as node user inside Docker (no sudo)
SAW_ROOT="${SAW_ROOT:-${AWAL_HOME}/.saw}"
SAW_SOCKET="${SAW_SOCKET:-${SAW_ROOT}/saw.sock}"
SAW_WALLET="${SAW_WALLET:-main}"
SAW_CHAIN="${SAW_CHAIN:-evm}"
SAW_LOG="/tmp/saw-daemon.log"

export SAW_SOCKET

# ── SAW daemon ─────────────────────────────────────────────────────────────

start_saw() {
  local saw_bin="${SAW_ROOT}/bin/saw-daemon"
  local saw_cli="${SAW_ROOT}/bin/saw"
  if [ ! -x "${saw_bin}" ]; then
    echo "[gateway-awal] SAW daemon not installed at ${saw_bin}, skipping"
    return 1
  fi

  # Init root if needed
  if [ ! -d "${SAW_ROOT}/keys" ]; then
    "${saw_cli}" install --root "${SAW_ROOT}"
    echo "[gateway-awal] SAW data directory initialized"
  fi

  # Generate key if needed
  local key_file="${SAW_ROOT}/keys/${SAW_CHAIN}/${SAW_WALLET}.key"
  if [ ! -f "${key_file}" ]; then
    "${saw_cli}" gen-key --chain "${SAW_CHAIN}" --wallet "${SAW_WALLET}" --root "${SAW_ROOT}"
    echo "[gateway-awal] SAW key generated"
  fi

  # Get SAW wallet address
  SAW_ADDRESS="$("${saw_cli}" address --chain "${SAW_CHAIN}" --wallet "${SAW_WALLET}" --root "${SAW_ROOT}" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{40}' | head -1)"
  echo "[gateway-awal] SAW wallet address: ${SAW_ADDRESS}"

  # Ensure socket directory exists
  mkdir -p "$(dirname "${SAW_SOCKET}")"

  # Start SAW daemon
  echo "[gateway-awal] starting SAW daemon..."
  nohup "${saw_bin}" --socket "${SAW_SOCKET}" --root "${SAW_ROOT}" > "${SAW_LOG}" 2>&1 &
  SAW_PID=$!

  # Wait for socket to appear
  local waited=0
  while [ ! -S "${SAW_SOCKET}" ] && [ "${waited}" -lt 50 ]; do
    sleep 0.1
    waited=$((waited + 1))
  done

  if [ ! -S "${SAW_SOCKET}" ]; then
    echo "[gateway-awal] ERROR: SAW socket did not appear after 5s. Log:" >&2
    cat "${SAW_LOG}" >&2
    return 1
  fi

  echo "[gateway-awal] SAW daemon running (pid=${SAW_PID}, socket=${SAW_SOCKET})"
  return 0
}

# ── awal Electron daemon ──────────────────────────────────────────────────

start_awal() {
  if [ ! -f "${AWAL_DIR}/.version" ]; then
    echo "[gateway-awal] awal not installed, skipping daemon"
    return 1
  fi

  echo "[gateway-awal] starting xvfb..."
  Xvfb :1 -screen 0 1280x800x24 -ac -nolisten tcp &
  sleep 1

  rm -f /tmp/payments-mcp-ui.lock

  echo "[gateway-awal] starting awal Electron daemon..."
  ELECTRON_DISABLE_SANDBOX=1 WALLET_STANDALONE=true \
    nohup xvfb-run --auto-servernum \
    "${AWAL_DIR}/node_modules/.bin/electron" \
    --no-sandbox --disable-gpu --disable-software-rasterizer \
    --disable-dev-shm-usage \
    "${AWAL_DIR}/bundle-electron.js" > "${AWAL_LOG}" 2>&1 &
  ELECTRON_PID=$!

  echo "[gateway-awal] waiting ${AWAL_INIT_TIMEOUT}s for Electron init (pid=${ELECTRON_PID})..."
  sleep "${AWAL_INIT_TIMEOUT}"

  if ! kill -0 "${ELECTRON_PID}" 2>/dev/null; then
    echo "[gateway-awal] ERROR: Electron died during init. Log:" >&2
    cat "${AWAL_LOG}" >&2
    return 1
  fi

  echo "[gateway-awal] awal Electron daemon running (pid=${ELECTRON_PID})"
  return 0
}

# ── Fund SAW wallet from awal ─────────────────────────────────────────────

fund_saw_from_awal() {
  if [ -z "${SAW_ADDRESS:-}" ]; then
    echo "[gateway-awal] no SAW address to fund"
    return 1
  fi

  echo "[gateway-awal] checking if SAW wallet needs USDC funding..."
  # The gateway node process will handle funding on-demand via the
  # x402-payment.ts awal-fund-saw logic. We just export the address
  # so the gateway knows where to send funds.
  export SAW_ADDRESS
  echo "[gateway-awal] SAW_ADDRESS=${SAW_ADDRESS} exported for gateway"
}

# ── Main ──────────────────────────────────────────────────────────────────

SAW_ADDRESS=""

# Start SAW daemon first (it's fast)
if start_saw; then
  echo "[gateway-awal] SAW daemon ready"
else
  echo "[gateway-awal] SAW daemon not available, will use fallback signing"
fi

# Start awal Electron daemon (slow — needs Xvfb + init timeout)
if start_awal; then
  fund_saw_from_awal
fi

# Start the gateway (pass through any extra args)
exec node dist/index.js gateway "$@"
