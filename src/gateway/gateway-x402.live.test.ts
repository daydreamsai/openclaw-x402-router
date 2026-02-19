import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/config.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { getFreePortBlockWithPermissionFallback } from "../test-utils/ports.js";
import { GatewayClient } from "./client.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "./protocol/client-info.js";
import { startGatewayServer } from "./server.js";
import { resolveX402LiveSettings } from "./x402-live-settings.js";

const LIVE = isTruthyEnvValue(process.env.LIVE) || isTruthyEnvValue(process.env.OPENCLAW_LIVE_TEST);
const X402_ENABLED = isTruthyEnvValue(process.env.OPENCLAW_LIVE_X402);
const describeLive = LIVE && X402_ENABLED ? describe : describe.skip;

type AgentFinalPayload = {
  status?: unknown;
  result?: unknown;
};

type ModelCatalogEntry = {
  id: string;
  name: string;
  api: "openai-completions" | "anthropic-messages";
  reasoning: boolean;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

function extractPayloadText(result: unknown): string {
  const record = result as Record<string, unknown>;
  const payloads = Array.isArray(record.payloads) ? record.payloads : [];
  const texts = payloads
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>).text : undefined))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  return texts.join("\n").trim();
}

function buildModelCatalog(modelRef: string): Record<string, ModelCatalogEntry> {
  const modelId = modelRef.replace(/^x402\//, "");
  const defaults: Record<string, ModelCatalogEntry> = {
    "moonshot:kimi-k2.5": {
      id: "moonshot:kimi-k2.5",
      name: "Moonshot Kimi K2.5",
      api: "openai-completions",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262_144,
      maxTokens: 8192,
    },
    "anthropic:claude-opus-4-5": {
      id: "anthropic:claude-opus-4-5",
      name: "Anthropic Opus 4.5",
      api: "anthropic-messages",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 8192,
    },
  };
  if (defaults[modelId]) {
    return defaults;
  }
  return {
    ...defaults,
    [modelId]: {
      id: modelId,
      name: modelId,
      api: modelId.startsWith("anthropic:") ? "anthropic-messages" : "openai-completions",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 8192,
    },
  };
}

async function getFreeGatewayPort(): Promise<number> {
  return await getFreePortBlockWithPermissionFallback({
    offsets: [0, 1, 2, 4],
    fallbackBase: 40_000,
  });
}

async function connectClient(params: { url: string; token: string }) {
  return await new Promise<GatewayClient>((resolve, reject) => {
    let settled = false;
    const stop = (err?: Error, client?: GatewayClient) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(client as GatewayClient);
      }
    };
    const client = new GatewayClient({
      url: params.url,
      token: params.token,
      clientName: GATEWAY_CLIENT_NAMES.TEST,
      clientDisplayName: "vitest-live-x402",
      clientVersion: "dev",
      mode: GATEWAY_CLIENT_MODES.TEST,
      onHelloOk: () => stop(undefined, client),
      onConnectError: (err) => stop(err),
      onClose: (code, reason) =>
        stop(new Error(`gateway closed during connect (${code}): ${reason}`)),
    });
    const timer = setTimeout(() => stop(new Error("gateway connect timeout")), 10_000);
    timer.unref();
    client.start();
  });
}

describeLive("gateway live (x402 local-signing)", () => {
  it(
    "runs an agent request through x402 without SAW",
    async () => {
      const settings = resolveX402LiveSettings(process.env);
      if (!settings) {
        return;
      }

      const previous = {
        configPath: process.env.OPENCLAW_CONFIG_PATH,
        token: process.env.OPENCLAW_GATEWAY_TOKEN,
        skipChannels: process.env.OPENCLAW_SKIP_CHANNELS,
        skipGmail: process.env.OPENCLAW_SKIP_GMAIL_WATCHER,
        skipCron: process.env.OPENCLAW_SKIP_CRON,
        skipCanvas: process.env.OPENCLAW_SKIP_CANVAS_HOST,
      };

      process.env.OPENCLAW_SKIP_CHANNELS = "1";
      process.env.OPENCLAW_SKIP_GMAIL_WATCHER = "1";
      process.env.OPENCLAW_SKIP_CRON = "1";
      process.env.OPENCLAW_SKIP_CANVAS_HOST = "1";

      const token = `test-${randomUUID()}`;
      process.env.OPENCLAW_GATEWAY_TOKEN = token;

      const cfg = loadConfig();
      const modelCatalog = buildModelCatalog(settings.modelRef);
      const pluginConfig = cfg.plugins?.entries?.["daydreams-x402-auth"]?.config;
      const nextCfg = {
        ...cfg,
        models: {
          ...cfg.models,
          providers: {
            ...cfg.models?.providers,
            x402: {
              ...cfg.models?.providers?.x402,
              baseUrl: settings.routerUrl,
              apiKey: settings.privateKey,
              api: "anthropic-messages",
              authHeader: false,
              models: Object.values(modelCatalog),
            },
          },
        },
        agents: {
          ...cfg.agents,
          defaults: {
            ...cfg.agents?.defaults,
            model: { primary: settings.modelRef },
            models: {
              ...cfg.agents?.defaults?.models,
              "x402/auto": {},
              ...Object.fromEntries(Object.keys(modelCatalog).map((id) => [`x402/${id}`, {}])),
            },
            sandbox: { mode: "off" },
          },
        },
        plugins: {
          ...cfg.plugins,
          entries: {
            ...cfg.plugins?.entries,
            "daydreams-x402-auth": {
              ...cfg.plugins?.entries?.["daydreams-x402-auth"],
              config: {
                ...pluginConfig,
                permitCap: settings.permitCapUsd,
                network: settings.network,
              },
            },
          },
        },
      };

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-live-x402-"));
      const tempConfigPath = path.join(tempDir, "openclaw.json");
      await fs.writeFile(tempConfigPath, `${JSON.stringify(nextCfg, null, 2)}\n`);
      process.env.OPENCLAW_CONFIG_PATH = tempConfigPath;

      const port = await getFreeGatewayPort();
      const server = await startGatewayServer(port, {
        bind: "loopback",
        auth: { mode: "token", token },
        controlUiEnabled: false,
      });
      const client = await connectClient({
        url: `ws://127.0.0.1:${port}`,
        token,
      });

      try {
        const sessionKey = "agent:dev:live-x402";
        const nonce = randomBytes(3).toString("hex").toUpperCase();
        const payload = await client.request<AgentFinalPayload>(
          "agent",
          {
            sessionKey,
            idempotencyKey: `idem-${randomUUID()}`,
            message: `Reply with: X402 LIVE OK ${nonce}. Include exactly one sentence.`,
            deliver: false,
          },
          { expectFinal: true },
        );
        if (payload?.status !== "ok") {
          throw new Error(`agent status=${String(payload?.status)}`);
        }
        const text = extractPayloadText(payload?.result);
        expect(text).toContain("X402");
        expect(text).toContain("LIVE");
        expect(text).toContain("OK");
        expect(text).toContain(nonce);
      } finally {
        client.stop();
        await server.close({ reason: "x402 live test complete" });
        await fs.rm(tempDir, { recursive: true, force: true });

        process.env.OPENCLAW_CONFIG_PATH = previous.configPath;
        process.env.OPENCLAW_GATEWAY_TOKEN = previous.token;
        process.env.OPENCLAW_SKIP_CHANNELS = previous.skipChannels;
        process.env.OPENCLAW_SKIP_GMAIL_WATCHER = previous.skipGmail;
        process.env.OPENCLAW_SKIP_CRON = previous.skipCron;
        process.env.OPENCLAW_SKIP_CANVAS_HOST = previous.skipCanvas;
      }
    },
    5 * 60 * 1000,
  );
});
