---
name: awal
description: "Manage Coinbase Agentic Wallet (awal) — authenticate, check balance, send USDC, trade tokens, and pay for x402 services in Docker."
metadata:
  openclaw:
    requires:
      bins: ["npx"]
      config: ["plugins.entries.daydreams-x402-auth.config.awalEmail"]
allowed-tools: ["shell"]
---

# Coinbase Agentic Wallet (awal)

The awal CLI manages a Coinbase-hosted wallet for AI agents. Private keys stay in
Coinbase infrastructure; you authenticate with email OTP.

## Prerequisites

- The `openclaw-sandbox-awal` Docker image must be running (provides xvfb + Electron).
- Check daemon health: `npx awal status`
- If status shows not running, check `/tmp/awal-electron.log` for errors.

## Authentication

Required on first use or after Electron data is wiped.

1. `npx awal auth login <email>` — sends a 6-digit OTP to your email, returns a `flowId`.
2. `npx awal auth verify <flowId> <6-digit-code>` — completes authentication.
3. `npx awal status` — confirm status shows authenticated.

## Wallet Commands

| Command                                             | Purpose                         |
| --------------------------------------------------- | ------------------------------- |
| `npx awal status`                                   | Server health + auth status     |
| `npx awal balance [--chain base\|base-sepolia]`     | USDC balance                    |
| `npx awal address`                                  | Wallet address                  |
| `npx awal send <amount> <address-or-ENS> [--chain]` | Send USDC                       |
| `npx awal trade <amount> <from-token> <to-token>`   | Swap tokens (Base mainnet only) |
| `npx awal show`                                     | Open wallet companion UI        |

## x402 Payments

| Command                               | Purpose                    |
| ------------------------------------- | -------------------------- |
| `npx awal x402 bazaar search <query>` | Discover paid API services |
| `npx awal x402 pay <url>`             | Make a paid API request    |

All commands accept `--json` for machine-readable output.

## Local Testing

Build and run the container interactively from the repo root (on your host machine):

```bash
docker build -f Dockerfile.sandbox-awal -t openclaw-sandbox-awal:local .
docker run -it --rm openclaw-sandbox-awal:local bash
```

Inside the container you land as the `sandbox` user (not root). Since `bash` bypasses
the default entrypoint, start xvfb manually before using awal:

```bash
Xvfb :1 -screen 0 1280x800x24 -ac -nolisten tcp &
export DISPLAY=:1
```

Then run through the authentication and wallet commands above. Do not use root —
Electron expects a non-root user and config files live under `/home/sandbox`.

## Troubleshooting

- **Daemon not running**: Check `/tmp/awal-electron.log`. Remove `/tmp/payments-mcp-ui.lock` if stale.
- **Auth expired**: Re-run the authentication flow above.
- **Electron crash**: The entrypoint auto-restarts on container restart. If persistent, check Electron deps with `ldd` on the electron binary.
