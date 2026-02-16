# Awal Headless Docker Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Coinbase Agentic Wallet (awal) to run inside OpenClaw Docker sandbox containers by adding headless Electron support via xvfb, a new auth method in the x402 plugin, and an awal credential path in the payment wrapper.

**Architecture:** Extend the existing `daydreams-x402-auth` plugin with a third auth method (`awal`) that stores credentials as `awal:<email>` sentinels. The payment wrapper (`x402-payment.ts`) detects these sentinels and delegates signing to the local awal Electron daemon via CLI. A new `Dockerfile.sandbox-awal` provides the headless runtime environment.

**Tech Stack:** Docker (debian:bookworm-slim), xvfb, Electron, Node.js, TypeScript, vitest

**Safety note:** Use `execFileNoThrow` from `src/utils/execFileNoThrow.ts` instead of `child_process.exec/execSync` to prevent shell injection.

---

### Task 1: Create the entrypoint script

**Files:**
- Create: `scripts/sandbox-awal-entrypoint.sh`

**Step 1: Write the entrypoint script**

```bash
#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:1
export HOME="${AWAL_HOME:-/home/sandbox}"
export XDG_CONFIG_HOME="${HOME}/.config"
export XDG_CACHE_HOME="${HOME}/.cache"

AWAL_DIR="${HOME}/.local/share/awal/server"
AWAL_LOG="/tmp/awal-electron.log"
AWAL_INIT_TIMEOUT="${AWAL_INIT_TIMEOUT:-15}"

mkdir -p "${HOME}" "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}"

# Start virtual framebuffer
Xvfb :1 -screen 0 1280x800x24 -ac -nolisten tcp &
XVFB_PID=$!
sleep 1

# Bootstrap awal server bundle if not already present
if [ ! -f "${AWAL_DIR}/.version" ]; then
  echo "[awal-entrypoint] bootstrapping awal server bundle..."
  npx awal@latest --version > /dev/null 2>&1 || true
  NPX_CACHE=$(find "${HOME}/.npm/_npx" -path '*/awal/server-bundle' -type d 2>/dev/null | head -1)
  if [ -z "${NPX_CACHE}" ]; then
    echo "[awal-entrypoint] ERROR: could not locate awal server-bundle in npx cache" >&2
    exit 1
  fi
  mkdir -p "${AWAL_DIR}"
  cp -r "${NPX_CACHE}/"* "${AWAL_DIR}/"
  cd "${AWAL_DIR}" && npm install --omit=dev
  AWAL_VERSION=$(npx awal@latest --version 2>/dev/null || echo "unknown")
  echo "${AWAL_VERSION}" > "${AWAL_DIR}/.version"
  echo "[awal-entrypoint] bootstrapped awal ${AWAL_VERSION}"
fi

# Remove stale lock file
rm -f /tmp/payments-mcp-ui.lock

# Start Electron headlessly
echo "[awal-entrypoint] starting awal Electron daemon..."
ELECTRON_DISABLE_SANDBOX=1 WALLET_STANDALONE=true \
  nohup xvfb-run --auto-servernum \
  "${AWAL_DIR}/node_modules/.bin/electron" \
  --no-sandbox --disable-gpu --disable-software-rasterizer \
  --disable-dev-shm-usage \
  "${AWAL_DIR}/bundle-electron.js" > "${AWAL_LOG}" 2>&1 &
ELECTRON_PID=$!

echo "[awal-entrypoint] waiting ${AWAL_INIT_TIMEOUT}s for Electron init (pid=${ELECTRON_PID})..."
sleep "${AWAL_INIT_TIMEOUT}"

# Verify Electron is still running
if ! kill -0 "${ELECTRON_PID}" 2>/dev/null; then
  echo "[awal-entrypoint] ERROR: Electron process died during init. Log:" >&2
  cat "${AWAL_LOG}" >&2
  exit 1
fi

echo "[awal-entrypoint] awal Electron daemon running (pid=${ELECTRON_PID})"

# Keep container alive — exit if Electron dies
wait "${ELECTRON_PID}"
```

**Step 2: Make it executable and verify**

Run: `chmod +x scripts/sandbox-awal-entrypoint.sh && file scripts/sandbox-awal-entrypoint.sh`
Expected: "Bourne-Again shell script" or similar

**Step 3: Commit**

```bash
git add scripts/sandbox-awal-entrypoint.sh
git commit -m "feat: add awal Electron headless entrypoint script"
```

---

### Task 2: Create the Dockerfile

**Files:**
- Create: `Dockerfile.sandbox-awal`

**Step 1: Write the Dockerfile**

Follow the pattern from `Dockerfile.sandbox-browser` (lines 1-32) and `Dockerfile.sandbox` (lines 1-20).

```dockerfile
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Electron's native dependencies + xvfb for headless display + Node for npx awal
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    jq \
    libasound2 \
    libatk-bridge2.0-0 \
    libcairo2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libpango-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    nodejs \
    npm \
    python3 \
    ripgrep \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/sandbox-awal-entrypoint.sh /usr/local/bin/openclaw-sandbox-awal
RUN chmod +x /usr/local/bin/openclaw-sandbox-awal

RUN useradd --create-home --shell /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox

CMD ["openclaw-sandbox-awal"]
```

**Step 2: Validate Dockerfile syntax**

Run: `docker build --check -f Dockerfile.sandbox-awal . 2>&1 || echo "Docker BuildKit check not available — syntax looks ok if no parse errors"`

**Step 3: Commit**

```bash
git add Dockerfile.sandbox-awal
git commit -m "feat: add Dockerfile.sandbox-awal for headless Electron"
```

---

### Task 3: Add awal sentinel parsing + tests

**Files:**
- Modify: `src/agents/x402-payment.ts:22-28` (add AWAL sentinel regex near SAW sentinel)
- Modify: `src/agents/x402-payment.ts:46-48` (extend SigningBackend union)
- Modify: `src/agents/x402-payment.ts:731-734` (export new parser in `__testing`)
- Test: `src/agents/x402-payment.test.ts`

**Step 1: Write the failing tests**

Add to `src/agents/x402-payment.test.ts` after the existing `parseSawConfig` tests (line 71):

```typescript
describe("parseAwalConfig", () => {
  it("parses a valid awal sentinel", () => {
    const result = __testing.parseAwalConfig("awal:user@example.com");
    expect(result).toEqual({ email: "user@example.com" });
  });

  it("parses an email with plus addressing", () => {
    const result = __testing.parseAwalConfig("awal:user+agent@example.com");
    expect(result).toEqual({ email: "user+agent@example.com" });
  });

  it("returns null for a SAW sentinel", () => {
    expect(__testing.parseAwalConfig("saw:main@/run/saw.sock")).toBeNull();
  });

  it("returns null for a private key", () => {
    expect(
      __testing.parseAwalConfig(
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      ),
    ).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(__testing.parseAwalConfig(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(__testing.parseAwalConfig("")).toBeNull();
  });

  it("returns null for awal: without email", () => {
    expect(__testing.parseAwalConfig("awal:")).toBeNull();
  });

  it("trims whitespace", () => {
    const result = __testing.parseAwalConfig("  awal:user@example.com  ");
    expect(result).toEqual({ email: "user@example.com" });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/agents/x402-payment.test.ts`
Expected: FAIL — `__testing.parseAwalConfig` is not a function

**Step 3: Implement parseAwalConfig**

In `src/agents/x402-payment.ts`, add after line 23 (SAW_SENTINEL_REGEX):

```typescript
// AWAL sentinel: "awal:<email>"
const AWAL_SENTINEL_REGEX = /^awal:(.+@.+\..+)$/;

interface AwalConfig {
  email: string;
}

function parseAwalConfig(apiKey: string | undefined): AwalConfig | null {
  if (!apiKey) {
    return null;
  }
  const match = AWAL_SENTINEL_REGEX.exec(apiKey.trim());
  if (!match) {
    return null;
  }
  return { email: match[1] };
}
```

Extend the `SigningBackend` type (line 46-48):

```typescript
type SigningBackend =
  | { mode: "key"; wallet: ReturnType<typeof createWalletClient>; account: Account }
  | { mode: "saw"; client: SawClient; ownerAddress: `0x${string}` }
  | { mode: "awal"; email: string };
```

Add to `__testing` export (line 731-734):

```typescript
export const __testing = {
  buildPermitCacheKey,
  parseSawConfig,
  parseAwalConfig,
};
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/agents/x402-payment.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/agents/x402-payment.ts src/agents/x402-payment.test.ts
git commit -m "feat: add awal sentinel parsing to x402 payment wrapper"
```

---

### Task 4: Wire awal backend into the payment wrapper

**Files:**
- Modify: `src/agents/x402-payment.ts:553-621` (the `maybeWrapStreamFnWithX402Payment` function)
- Reference: `src/utils/execFileNoThrow.ts` (use this instead of child_process.exec)

**Step 1: Update signing mode detection**

In `maybeWrapStreamFnWithX402Payment` (around line 566-571), change the detection logic to check awal first, then SAW, then raw key:

```typescript
  // Detect signing mode: awal sentinel → SAW sentinel → raw private key
  const awalConfig = parseAwalConfig(params.apiKey);
  const sawConfig = awalConfig ? null : parseSawConfig(params.apiKey);
  const privateKey = sawConfig ? null : awalConfig ? null : normalizePrivateKey(params.apiKey);
  if (!awalConfig && !sawConfig && !privateKey) {
    return params.streamFn;
  }
```

**Step 2: Add awal backend branch**

After the existing SAW and key backend branches (around line 588-621), add the awal branch:

```typescript
  let backendPromise: Promise<SigningBackend>;
  if (awalConfig) {
    log.info("x402 using awal backend", { email: awalConfig.email });
    backendPromise = Promise.resolve({
      mode: "awal",
      email: awalConfig.email,
    } satisfies SigningBackend);
  } else if (sawConfig) {
    // ... existing SAW code unchanged ...
  } else {
    // ... existing key code unchanged ...
  }
```

**Step 3: Add signPermitViaAwal using execFileNoThrow**

Import `execFileNoThrow` from `src/utils/execFileNoThrow.ts` (check exact export name/path first by reading the file). Use `execFileNoThrow` instead of `child_process.execSync` to prevent shell injection:

```typescript
import { execFileNoThrow } from "../utils/execFileNoThrow.js";

async function signPermitViaAwal(params: {
  config: RouterConfig;
  permitCap: string;
}): Promise<{ signature: string; nonce: string; deadline: string; ownerAddress: string }> {
  // Get the wallet address from awal
  const addressResult = await execFileNoThrow("npx", ["awal", "address", "--json"], {
    env: { ...process.env, DISPLAY: ":1" },
  });
  if (addressResult.status !== 0) {
    throw new Error(`awal address failed: ${addressResult.stderr}`);
  }
  const { address } = JSON.parse(addressResult.stdout.trim()) as { address: string };

  const chain = CHAINS[params.config.network] || base;
  const chainId = Number.parseInt(params.config.network.split(":")[1] ?? "0", 10);
  const deadline = Math.floor(Date.now() / 1000) + DEFAULT_VALIDITY_SECONDS;
  const nonceValue = await fetchPermitNonce(
    chain,
    params.config.asset as `0x${string}`,
    address as `0x${string}`,
  );

  log.info("signing permit via awal", {
    owner: address,
    spender: params.config.facilitatorSigner,
    network: params.config.network,
    nonce: nonceValue.toString(),
  });

  // Have awal sign the permit via its local Electron daemon
  const signResult = await execFileNoThrow("npx", [
    "awal", "x402", "sign-permit",
    "--chain-id", chainId.toString(),
    "--token", params.config.asset,
    "--name", params.config.tokenName,
    "--version", params.config.tokenVersion,
    "--spender", params.config.facilitatorSigner,
    "--value", params.permitCap,
    "--nonce", nonceValue.toString(),
    "--deadline", deadline.toString(),
    "--owner", address,
    "--json",
  ], {
    env: { ...process.env, DISPLAY: ":1" },
  });
  if (signResult.status !== 0) {
    throw new Error(`awal sign-permit failed: ${signResult.stderr}`);
  }
  const { signature } = JSON.parse(signResult.stdout.trim()) as { signature: string };

  log.info("awal permit signed", { address, sigPrefix: signature.slice(0, 14) });

  return {
    signature,
    nonce: nonceValue.toString(),
    deadline: deadline.toString(),
    ownerAddress: address,
  };
}
```

**NOTE:** The exact `awal x402 sign-permit` CLI interface may not exist yet — this is based on the `awal x402 pay` command pattern from Coinbase docs. If awal doesn't expose a dedicated sign-permit subcommand, an alternative is to use `awal x402 pay <router-url>` and let awal handle the full payment flow internally. Check `npx awal x402 --help` at runtime to determine available subcommands and adjust accordingly.

**Step 4: Update getOwnerAddress and createCachedPermit**

Update `getOwnerAddress` to handle awal mode:

```typescript
function getOwnerAddress(backend: SigningBackend): `0x${string}` {
  if (backend.mode === "key") return backend.account.address;
  if (backend.mode === "saw") return backend.ownerAddress;
  // awal mode — address resolved during signing
  return "0x0000000000000000000000000000000000000000";
}
```

Update `createCachedPermit` to add the awal branch:

```typescript
  const signResult =
    params.backend.mode === "awal"
      ? await signPermitViaAwal({
          config: params.config,
          permitCap: params.permitCap,
        })
      : params.backend.mode === "key"
        ? await signPermit({
            wallet: params.backend.wallet,
            account: params.backend.account,
            config: params.config,
            permitCap: params.permitCap,
          })
        : await signPermitViaSaw({
            client: params.backend.client,
            ownerAddress: params.backend.ownerAddress,
            config: params.config,
            permitCap: params.permitCap,
          });

  // For awal mode, use the returned ownerAddress
  const owner = params.backend.mode === "awal"
    ? (signResult as { ownerAddress: string }).ownerAddress as `0x${string}`
    : getOwnerAddress(params.backend);

  const { signature, nonce, deadline } = signResult;
```

**Step 5: Run full test suite**

Run: `npx vitest run src/agents/x402-payment.test.ts`
Expected: ALL PASS (existing tests should remain green; awal code paths won't be hit without awal sentinel)

**Step 6: Commit**

```bash
git add src/agents/x402-payment.ts
git commit -m "feat: wire awal signing backend into x402 payment wrapper"
```

---

### Task 5: Add awal auth method to the plugin

**Files:**
- Modify: `extensions/daydreams-x402-auth/index.ts:59-334` (add third auth entry)
- Modify: `extensions/daydreams-x402-auth/openclaw.plugin.json`

**Step 1: Add the awal auth entry**

In `extensions/daydreams-x402-auth/index.ts`, add a new auth entry in the `auth` array after the `wallet` entry (before line 334, the closing bracket of `auth`). Follow the exact pattern of the `saw` and `wallet` entries:

```typescript
        {
          id: "awal",
          label: "Coinbase Agentic Wallet (awal)",
          hint: "Email-authenticated wallet via Coinbase — requires headless Electron in Docker",
          kind: "api_key",
          run: async (ctx) => {
            await ctx.prompter.note(
              [
                "Coinbase Agentic Wallet authenticates via email OTP.",
                "An Electron process runs headlessly to handle signing.",
                "Requires the openclaw-sandbox-awal Docker image.",
              ].join("\n"),
              "awal",
            );

            const emailInput = await ctx.prompter.text({
              message: "Email for awal authentication",
              validate: (value) =>
                value.trim().includes("@") ? undefined : "Valid email required",
            });
            const email = String(emailInput).trim();

            const routerInput = await ctx.prompter.text({
              message: "Daydreams Router URL",
              initialValue: DEFAULT_ROUTER_URL,
              validate: (value) => {
                try {
                  new URL(value);
                  return undefined;
                } catch {
                  return "Invalid URL";
                }
              },
            });
            const routerUrl = normalizeRouterUrl(String(routerInput));

            const capInput = await ctx.prompter.text({
              message: "Permit cap (USD)",
              initialValue: String(DEFAULT_PERMIT_CAP_USD),
              validate: (value) =>
                normalizePermitCap(value) ? undefined : "Invalid amount",
            });
            const permitCap =
              normalizePermitCap(String(capInput)) ?? DEFAULT_PERMIT_CAP_USD;

            const networkInput = await ctx.prompter.text({
              message: "Network (CAIP-2)",
              initialValue: DEFAULT_NETWORK,
              validate: (value) =>
                normalizeNetwork(value) ? undefined : "Required",
            });
            const network =
              normalizeNetwork(String(networkInput)) ?? DEFAULT_NETWORK;

            const existingPluginConfig =
              ctx.config.plugins?.entries?.[PLUGIN_ID]?.config &&
              typeof ctx.config.plugins.entries[PLUGIN_ID]?.config === "object"
                ? (ctx.config.plugins.entries[PLUGIN_ID]?.config as Record<
                    string,
                    unknown
                  >)
                : {};

            const pluginConfigPatch: Record<string, unknown> = {
              ...existingPluginConfig,
            };
            if (existingPluginConfig.permitCap === undefined) {
              pluginConfigPatch.permitCap = permitCap;
            }
            if (!existingPluginConfig.network) {
              pluginConfigPatch.network = network;
            }
            pluginConfigPatch.awalEmail = email;

            return {
              profiles: [
                {
                  profileId: "x402:default",
                  credential: {
                    type: "api_key",
                    provider: PROVIDER_ID,
                    key: `awal:${email}`,
                  },
                },
              ],
              configPatch: {
                plugins: {
                  entries: {
                    [PLUGIN_ID]: {
                      config: pluginConfigPatch,
                    },
                  },
                },
                models: {
                  providers: {
                    [PROVIDER_ID]: {
                      baseUrl: routerUrl,
                      apiKey: "x402-wallet",
                      api: "anthropic-messages",
                      authHeader: false,
                      models: [
                        {
                          id: DEFAULT_MODEL_ID,
                          name: "Moonshot Kimi K2.5",
                          api: "openai-completions",
                          reasoning: false,
                          input: ["text", "image"],
                          cost: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                          },
                          contextWindow: 262144,
                          maxTokens: 8192,
                        },
                        {
                          id: ANTHROPIC_MODEL_ID,
                          name: "Anthropic Opus 4.5",
                          reasoning: false,
                          input: ["text", "image"],
                          cost: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                          },
                          contextWindow: 200000,
                          maxTokens: 8192,
                        },
                      ],
                    },
                  },
                },
                agents: {
                  defaults: {
                    models: {
                      [DEFAULT_AUTO_REF]: {},
                      [DEFAULT_MODEL_REF]: { alias: "Kimi" },
                      [ANTHROPIC_MODEL_REF]: { alias: "Opus" },
                    },
                  },
                },
              },
              defaultModel: DEFAULT_AUTO_REF,
              notes: [
                `Awal wallet configured for ${email}.`,
                `Daydreams Router base URL set to ${routerUrl}.`,
                'Run "npx awal auth login" inside the sandbox to authenticate.',
                "Ensure the openclaw-sandbox-awal Docker image is running.",
              ],
            };
          },
        },
```

**Step 2: Update the plugin manifest**

In `extensions/daydreams-x402-auth/openclaw.plugin.json`, add `awalEmail` to properties and add `skills` field:

```json
{
  "id": "daydreams-x402-auth",
  "providers": ["x402"],
  "skills": ["./skills"],
  "uiHints": {
    "permitCap": {
      "label": "Permit Cap (USD)",
      "help": "Maximum USDC spend authorized per permit. Example: 10 = $10.00"
    },
    "network": {
      "label": "Network (CAIP-2)",
      "help": "Examples: eip155:8453 (Base), eip155:1 (Ethereum)",
      "advanced": true
    },
    "awalEmail": {
      "label": "Awal Email",
      "help": "Email used for Coinbase Agentic Wallet OTP authentication",
      "advanced": true
    }
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "permitCap": {
        "type": "number",
        "minimum": 0.01
      },
      "network": {
        "type": "string"
      },
      "awalEmail": {
        "type": "string"
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add extensions/daydreams-x402-auth/index.ts extensions/daydreams-x402-auth/openclaw.plugin.json
git commit -m "feat: add awal auth method to x402 plugin"
```

---

### Task 6: Create the bundled skill

**Files:**
- Create: `extensions/daydreams-x402-auth/skills/awal/SKILL.md`

**Step 1: Write the skill**

```markdown
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

| Command | Purpose |
|---------|---------|
| `npx awal status` | Server health + auth status |
| `npx awal balance [--chain base\|base-sepolia]` | USDC balance |
| `npx awal address` | Wallet address |
| `npx awal send <amount> <address-or-ENS> [--chain]` | Send USDC |
| `npx awal trade <amount> <from-token> <to-token>` | Swap tokens (Base mainnet only) |
| `npx awal show` | Open wallet companion UI |

## x402 Payments

| Command | Purpose |
|---------|---------|
| `npx awal x402 bazaar search <query>` | Discover paid API services |
| `npx awal x402 pay <url>` | Make a paid API request |

All commands accept `--json` for machine-readable output.

## Troubleshooting

- **Daemon not running**: Check `/tmp/awal-electron.log`. Remove `/tmp/payments-mcp-ui.lock` if stale.
- **Auth expired**: Re-run the authentication flow above.
- **Electron crash**: The entrypoint auto-restarts on container restart. If persistent, check Electron deps with `ldd` on the electron binary.
```

**Step 2: Verify skill directory structure**

Run: `ls -la extensions/daydreams-x402-auth/skills/awal/SKILL.md`
Expected: file exists

**Step 3: Commit**

```bash
git add extensions/daydreams-x402-auth/skills/awal/SKILL.md
git commit -m "feat: add awal agent skill to x402 plugin"
```

---

### Task 7: Integration smoke test

**Step 1: Build the Docker image**

Run: `docker build -f Dockerfile.sandbox-awal -t openclaw-sandbox-awal:local .`
Expected: Build succeeds. Watch for any missing package errors.

**Step 2: Verify entrypoint deps are present**

Run: `docker run --rm openclaw-sandbox-awal:local bash -c "which xvfb-run && which npx && echo 'deps ok'"`
Expected: Prints paths to both binaries + "deps ok"

**Step 3: Run unit tests**

Run: `npx vitest run src/agents/x402-payment.test.ts`
Expected: ALL PASS

**Step 4: Commit any fixes if needed**

If any fixes were required, commit them individually with descriptive messages.

---

### Task 8: Final review

**Step 1: Review all changes**

Run: `git diff main --stat`
Expected output should show exactly these files:
- `Dockerfile.sandbox-awal` (new)
- `scripts/sandbox-awal-entrypoint.sh` (new)
- `extensions/daydreams-x402-auth/index.ts` (modified)
- `extensions/daydreams-x402-auth/openclaw.plugin.json` (modified)
- `extensions/daydreams-x402-auth/skills/awal/SKILL.md` (new)
- `src/agents/x402-payment.ts` (modified)
- `src/agents/x402-payment.test.ts` (modified)
- `docs/plans/` (new, 2 files)

**Step 2: Verify no leftover debug code or TODOs**

Run: `grep -rn "TODO\|FIXME\|console.log\|debugger" Dockerfile.sandbox-awal scripts/sandbox-awal-entrypoint.sh extensions/daydreams-x402-auth/ src/agents/x402-payment.ts`
Expected: No matches (or only pre-existing ones)
