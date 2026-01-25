import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceX402(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  return await applyAuthChoicePluginProvider(params, {
    authChoice: "x402",
    pluginId: "opencode-x402-auth",
    providerId: "x402",
    methodId: "wallet",
    label: "Daydreams Router (x402)",
  });
}
