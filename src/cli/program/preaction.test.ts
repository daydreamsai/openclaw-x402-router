import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { markCommandRequiresPluginRegistry } from "./command-metadata.js";

vi.mock("../plugin-registry.js", () => ({
  ensurePluginRegistryLoaded: vi.fn(),
}));
vi.mock("./config-guard.js", () => ({
  ensureConfigReady: vi.fn(async () => {}),
}));
vi.mock("../banner.js", () => ({
  emitCliBanner: vi.fn(),
}));
vi.mock("../argv.js", () => ({
  getCommandPath: vi.fn(() => ["message"]),
  hasHelpOrVersion: vi.fn(() => false),
}));

const loadRegisterPreActionHooks = async () => {
  const mod = await import("./preaction.js");
  return mod.registerPreActionHooks;
};

const loadEnsurePluginRegistryLoaded = async () => {
  const mod = await import("../plugin-registry.js");
  return mod.ensurePluginRegistryLoaded;
};

describe("registerPreActionHooks", () => {
  beforeEach(async () => {
    const ensurePluginRegistryLoaded = await loadEnsurePluginRegistryLoaded();
    vi.mocked(ensurePluginRegistryLoaded).mockClear();
  });

  it("loads plugins for marked commands", async () => {
    const registerPreActionHooks = await loadRegisterPreActionHooks();
    const ensurePluginRegistryLoaded = await loadEnsurePluginRegistryLoaded();
    const program = new Command();
    registerPreActionHooks(program, "test");

    const message = program.command("message").action(() => {});
    markCommandRequiresPluginRegistry(message);

    const originalArgv = process.argv;
    const argv = ["node", "clawdbot", "message"];
    process.argv = argv;
    try {
      await program.parseAsync(argv);
    } finally {
      process.argv = originalArgv;
    }

    expect(vi.mocked(ensurePluginRegistryLoaded)).toHaveBeenCalledTimes(1);
  });
});
