import {
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from "openclaw/plugin-sdk";

const PROVIDER_ID = "x402";
const PROVIDER_LABEL = "Daydreams Router (x402)";
const PLUGIN_ID = "daydreams-x402-auth";

const DEFAULT_ROUTER_URL = "https://ai.xgate.run";
const DEFAULT_NETWORK = "eip155:8453";
const DEFAULT_PERMIT_CAP_USD = 10;
const AUTO_MODEL_ID = "auto";
const DEFAULT_MODEL_ID = "kimi-k2.5";
const DEFAULT_MODEL_REF = `x402/${DEFAULT_MODEL_ID}`;
const OPUS_MODEL_ID = "claude-opus-4-6";
const OPUS_MODEL_REF = `x402/${OPUS_MODEL_ID}`;
const SONNET_MODEL_ID = "claude-sonnet-4-6";
const SONNET_MODEL_REF = `x402/${SONNET_MODEL_ID}`;
const GPT5_MODEL_ID = "gpt-5";
const GPT5_MODEL_REF = `x402/${GPT5_MODEL_ID}`;
const CODEX_MODEL_ID = "gpt-5.3-codex";
const CODEX_MODEL_REF = `x402/${CODEX_MODEL_ID}`;
const DEFAULT_AUTO_REF = `x402/${AUTO_MODEL_ID}`;
const FALLBACK_CONTEXT_WINDOW = 128000;
const FALLBACK_MAX_TOKENS = 8192;

const PRIVATE_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_SAW_SOCKET = process.env.SAW_SOCKET || "/run/saw/saw.sock";
const DEFAULT_SAW_WALLET = "main";

type X402ModelDefinition = {
  id: string;
  name: string;
  api: "anthropic-messages" | "openai-completions" | "openai-responses";
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

const X402_MODELS: X402ModelDefinition[] = [
  {
    id: AUTO_MODEL_ID,
    name: "Auto (Smart Routing)",
    api: "openai-completions",
    reasoning: true,
    input: ["text", "image"],
    // Router selects the final provider/model at request time.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: FALLBACK_CONTEXT_WINDOW,
    maxTokens: FALLBACK_MAX_TOKENS,
  },
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5 (latest)",
    api: "anthropic-messages",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: OPUS_MODEL_ID,
    name: "Claude Opus 4.6 (latest)",
    api: "anthropic-messages",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: SONNET_MODEL_ID,
    name: "Claude Sonnet 4.6 (latest)",
    api: "anthropic-messages",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: DEFAULT_MODEL_ID,
    name: "Kimi K2.5",
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0.6, output: 3, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 8192,
  },
  {
    id: GPT5_MODEL_ID,
    name: "GPT-5",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5-nano",
    name: "GPT-5 Nano",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5-pro",
    name: "GPT-5 Pro",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 15, output: 120, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 272000,
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: CODEX_MODEL_ID,
    name: "GPT-5.3 Codex",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: "anthropic/claude-3.5-haiku",
    name: "Claude Haiku 3.5",
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
  {
    id: "anthropic/claude-3.7-sonnet",
    name: "Claude Sonnet 3.7",
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 200000,
    maxTokens: 128000,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: "anthropic/claude-opus-4",
    name: "Claude Opus 4",
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: "anthropic/claude-opus-4.1",
    name: "Claude Opus 4.1",
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: "anthropic/claude-opus-4.5",
    name: "Claude Opus 4.5",
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    api: "openai-completions",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
];

const MODEL_ALIAS_BY_ID: Record<string, string | undefined> = {
  [AUTO_MODEL_ID]: "Auto",
  [DEFAULT_MODEL_ID]: "Kimi",
  [OPUS_MODEL_ID]: "Opus",
  [SONNET_MODEL_ID]: "Sonnet",
  [GPT5_MODEL_ID]: "GPT-5",
  [CODEX_MODEL_ID]: "Codex",
};

function buildDefaultModelOptions() {
  return X402_MODELS.map((model) => {
    const value = `x402/${model.id}`;
    return {
      value,
      label: model.name,
      hint: value === DEFAULT_AUTO_REF ? "Router chooses the model automatically" : value,
    };
  });
}

async function promptDefaultModelRef(ctx: ProviderAuthContext): Promise<string> {
  const options = buildDefaultModelOptions();
  if (options.length === 0) {
    return DEFAULT_AUTO_REF;
  }
  if (options.length === 1) {
    return options[0]?.value ?? DEFAULT_AUTO_REF;
  }

  const selected = String(
    await ctx.prompter.select({
      message: "Default Daydreams model",
      options,
      initialValue: DEFAULT_AUTO_REF,
    }),
  ).trim();

  return options.some((option) => option.value === selected) ? selected : DEFAULT_AUTO_REF;
}

function buildDefaultAllowlistedModels(): Record<string, { alias?: string }> {
  const entries: Record<string, { alias?: string }> = {};
  for (const model of X402_MODELS) {
    const key = `x402/${model.id}`;
    const alias = MODEL_ALIAS_BY_ID[model.id];
    entries[key] = alias ? { alias } : {};
  }
  return entries;
}

function cloneX402Models() {
  return X402_MODELS.map((model) => ({
    ...model,
    input: [...model.input],
    cost: { ...model.cost },
  }));
}

function normalizePrivateKey(value: string): string | null {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("0X") ? `0x${trimmed.slice(2)}` : trimmed;
  return PRIVATE_KEY_REGEX.test(normalized) ? normalized : null;
}

function buildSawSentinel(walletName: string, socketPath: string): string {
  return `saw:${walletName}@${socketPath}`;
}

function normalizeRouterUrl(value: string): string {
  const raw = value.trim() || DEFAULT_ROUTER_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  // Store the bare origin — SDKs and the payment wrapper add paths as needed
  return withProtocol.replace(/\/+$/, "").replace(/\/v1\/?$/, "");
}

function normalizePermitCap(value: string): number | null {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeNetwork(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

const x402Plugin = {
  id: PLUGIN_ID,
  name: "Daydreams Router (x402) Auth",
  description: "Permit-signed auth for Daydreams Router (x402)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/x402",
      auth: [
        {
          id: "saw",
          label: "Secure Agent Wallet (SAW)",
          hint: "Signs permits via SAW daemon (recommended)",
          kind: "api_key",
          run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
            await ctx.prompter.note(
              [
                "SAW keeps private keys in a separate daemon process,",
                "preventing prompt injection from exfiltrating them.",
                "The SAW daemon must be running before use.",
              ].join("\n"),
              "SAW",
            );

            const socketInput = await ctx.prompter.text({
              message: "SAW daemon socket path",
              initialValue: DEFAULT_SAW_SOCKET,
              validate: (value: string) => (value.trim() ? undefined : "Socket path required"),
            });
            const socketPath = String(socketInput).trim();

            const walletInput = await ctx.prompter.text({
              message: "SAW wallet name",
              initialValue: DEFAULT_SAW_WALLET,
              validate: (value: string) => (value.trim() ? undefined : "Wallet name required"),
            });
            const walletName = String(walletInput).trim();

            const routerInput = await ctx.prompter.text({
              message: "Daydreams Router URL",
              initialValue: DEFAULT_ROUTER_URL,
              validate: (value: string) => {
                try {
                  // eslint-disable-next-line no-new
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
              validate: (value: string) =>
                normalizePermitCap(value) ? undefined : "Invalid amount",
            });
            const permitCap = normalizePermitCap(String(capInput)) ?? DEFAULT_PERMIT_CAP_USD;

            const networkInput = await ctx.prompter.text({
              message: "Network (CAIP-2)",
              initialValue: DEFAULT_NETWORK,
              validate: (value: string) => (normalizeNetwork(value) ? undefined : "Required"),
            });
            const network = normalizeNetwork(String(networkInput)) ?? DEFAULT_NETWORK;
            const selectedDefaultModelRef = await promptDefaultModelRef(ctx);

            const existingPluginConfig =
              ctx.config.plugins?.entries?.[PLUGIN_ID]?.config &&
              typeof ctx.config.plugins.entries[PLUGIN_ID]?.config === "object"
                ? (ctx.config.plugins.entries[PLUGIN_ID]?.config as Record<string, unknown>)
                : {};

            const pluginConfigPatch: Record<string, unknown> = { ...existingPluginConfig };
            if (existingPluginConfig.permitCap === undefined) {
              pluginConfigPatch.permitCap = permitCap;
            }
            if (!existingPluginConfig.network) {
              pluginConfigPatch.network = network;
            }

            return {
              profiles: [
                {
                  profileId: "x402:default",
                  credential: {
                    type: "api_key",
                    provider: PROVIDER_ID,
                    key: buildSawSentinel(walletName, socketPath),
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
                      models: cloneX402Models(),
                    },
                  },
                },
                agents: {
                  defaults: {
                    models: buildDefaultAllowlistedModels(),
                  },
                },
              },
              defaultModel: selectedDefaultModelRef,
              notes: [
                `Daydreams Router base URL set to ${routerUrl}.`,
                `SAW signing via wallet "${walletName}" at ${socketPath}.`,
                "Permit caps apply per signed session; update plugins.entries.daydreams-x402-auth.config to change.",
              ],
            };
          },
        },
        {
          id: "wallet",
          label: "Wallet private key",
          hint: "Signs ERC-2612 permits per request",
          kind: "api_key",
          run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
            await ctx.prompter.note(
              [
                "Daydreams Router uses wallet-signed ERC-2612 permits for payment in USDC.",
                "Use a dedicated wallet for AI spend; keys are stored locally.",
              ].join("\n"),
              "x402",
            );

            const keyInput = await ctx.prompter.text({
              message: "Wallet private key (0x + 64 hex chars)",
              validate: (value: string) =>
                normalizePrivateKey(value) ? undefined : "Invalid private key format",
            });
            const normalizedKey = normalizePrivateKey(String(keyInput));
            if (!normalizedKey) throw new Error("Invalid private key format");

            const routerInput = await ctx.prompter.text({
              message: "Daydreams Router URL",
              initialValue: DEFAULT_ROUTER_URL,
              validate: (value: string) => {
                try {
                  // eslint-disable-next-line no-new
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
              validate: (value: string) =>
                normalizePermitCap(value) ? undefined : "Invalid amount",
            });
            const permitCap = normalizePermitCap(String(capInput)) ?? DEFAULT_PERMIT_CAP_USD;

            const networkInput = await ctx.prompter.text({
              message: "Network (CAIP-2)",
              initialValue: DEFAULT_NETWORK,
              validate: (value: string) => (normalizeNetwork(value) ? undefined : "Required"),
            });
            const network = normalizeNetwork(String(networkInput)) ?? DEFAULT_NETWORK;
            const selectedDefaultModelRef = await promptDefaultModelRef(ctx);

            const existingPluginConfig =
              ctx.config.plugins?.entries?.[PLUGIN_ID]?.config &&
              typeof ctx.config.plugins.entries[PLUGIN_ID]?.config === "object"
                ? (ctx.config.plugins.entries[PLUGIN_ID]?.config as Record<string, unknown>)
                : {};

            const pluginConfigPatch: Record<string, unknown> = { ...existingPluginConfig };
            if (existingPluginConfig.permitCap === undefined) {
              pluginConfigPatch.permitCap = permitCap;
            }
            if (!existingPluginConfig.network) {
              pluginConfigPatch.network = network;
            }

            return {
              profiles: [
                {
                  profileId: "x402:default",
                  credential: {
                    type: "api_key",
                    provider: PROVIDER_ID,
                    key: normalizedKey,
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
                      models: cloneX402Models(),
                    },
                  },
                },
                agents: {
                  defaults: {
                    models: buildDefaultAllowlistedModels(),
                  },
                },
              },
              defaultModel: selectedDefaultModelRef,
              notes: [
                `Daydreams Router base URL set to ${routerUrl}.`,
                "Permit caps apply per signed session; update plugins.entries.daydreams-x402-auth.config to change.",
              ],
            };
          },
        },
      ],
    });
  },
};

export default x402Plugin;
