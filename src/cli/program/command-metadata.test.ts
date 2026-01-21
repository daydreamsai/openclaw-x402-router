import { Command } from "commander";
import { describe, expect, it } from "vitest";

import {
  commandRequiresPluginRegistry,
  markCommandRequiresPluginRegistry,
} from "./command-metadata.js";

describe("commandRequiresPluginRegistry", () => {
  it("detects direct requirement", () => {
    const program = new Command();
    const cmd = program.command("message");
    markCommandRequiresPluginRegistry(cmd);
    expect(commandRequiresPluginRegistry(cmd)).toBe(true);
  });

  it("walks parent chain", () => {
    const program = new Command();
    const parent = program.command("channels");
    const child = parent.command("list");
    markCommandRequiresPluginRegistry(parent);
    expect(commandRequiresPluginRegistry(child)).toBe(true);
  });
});
