# Design: Coinbase Agentic Wallet (awal) Headless Docker Integration

**Date**: 2026-02-15
**Status**: Approved

## Problem

Coinbase's Agentic Wallet (`awal`) requires an Electron companion app for authentication and transaction signing. On a desktop this works natively, but inside Docker containers (OpenClaw's sandbox environment), there is no display server. The Electron process hangs on startup and eventually times out, blocking all wallet operations.

A proven workaround exists: run Electron headlessly via `xvfb-run` with specific flags (`ELECTRON_DISABLE_SANDBOX=1`, `WALLET_STANDALONE=true`, `--no-sandbox`, `--disable-gpu`, `--disable-software-rasterizer`, `--disable-dev-shm-usage`). This has been validated on a Hetzner VPS.

## Solution

Extend the existing `daydreams-x402-auth` plugin with a third auth method (`awal`) alongside `saw` and `wallet`, plus a new Docker sandbox layer that provides the headless Electron environment.

## Components

### 1. Dockerfile Layer (`Dockerfile.sandbox-awal`)

New Docker image based on `debian:bookworm-slim` with:
- `xvfb` — virtual framebuffer for headless display
- `libnss3`, `libatk-bridge2.0-0`, `libgtk-3-0`, `libgbm1`, `libasound2`, `libx11-xcb1`, `libxcomposite1`, `libxdamage1`, `libxrandr2`, `libpango-1.0-0`, `libcairo2` — Electron's native dependencies
- `nodejs`, `npm` — for `npx awal` CLI
- Standard sandbox tools: `bash`, `ca-certificates`, `curl`, `git`, `jq`

### 2. Entrypoint Script (`scripts/sandbox-awal-entrypoint.sh`)

Handles the full lifecycle:
1. Start Xvfb on display `:1`
2. Bootstrap awal server bundle (one-time): populate npx cache, copy `server-bundle` to `~/.local/share/awal/server`, install deps, write version marker
3. Remove stale `/tmp/payments-mcp-ui.lock`
4. Launch Electron headless with environment flags: `ELECTRON_DISABLE_SANDBOX=1 WALLET_STANDALONE=true xvfb-run --auto-servernum electron --no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage bundle-electron.js`
5. Wait ~15 seconds for initialization

### 3. Plugin Auth Method (`extensions/daydreams-x402-auth/index.ts`)

New auth entry alongside existing `saw` and `wallet`:
- ID: `awal`
- Label: "Coinbase Agentic Wallet (awal)"
- Prompts for: email, router URL, permit cap, network
- Stores credential as `awal:<email>` sentinel value
- Adds `awalEmail` to plugin config
- Returns same model/provider configuration as other auth methods

### 4. Payment Wrapper (`src/agents/x402-payment.ts`)

Detects `awal:` prefix on credential key. Routes signing through the awal CLI or local Electron daemon rather than direct viem wallet signing.

### 5. Plugin Manifest (`openclaw.plugin.json`)

- Add `awalEmail` string property to `configSchema`
- Add `"skills": ["./skills"]` to bundle the agent skill

### 6. Bundled Skill (`extensions/daydreams-x402-auth/skills/awal/SKILL.md`)

Markdown skill teaching agents how to:
- Check awal daemon health (`npx awal status`)
- Authenticate via email OTP flow
- Check balance, send USDC, trade tokens
- Pay for x402 services
- Troubleshoot common issues

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `Dockerfile.sandbox-awal` | Create | Docker image with xvfb + Electron deps |
| `scripts/sandbox-awal-entrypoint.sh` | Create | Boots Xvfb + awal Electron daemon |
| `extensions/daydreams-x402-auth/index.ts` | Modify | Add `awal` auth method |
| `extensions/daydreams-x402-auth/openclaw.plugin.json` | Modify | Add `awalEmail` config + `skills` ref |
| `extensions/daydreams-x402-auth/skills/awal/SKILL.md` | Create | Agent skill for awal usage |
| `src/agents/x402-payment.ts` | Modify | Handle `awal:` credential sentinel |

## Security Considerations

- Electron runs with `--no-sandbox` inside the Docker container (the Docker container itself is the sandbox)
- Private keys remain in Coinbase infrastructure; only email OTP auth happens locally
- Spending limits enforced by awal's built-in guardrails
- The `awal:` sentinel in config does not contain secrets

## Dependencies

- Coinbase `awal` package (installed at runtime via `npx awal@latest`)
- Electron (installed as dependency of awal server bundle)
- xvfb, libnss3, and Electron's native library dependencies
