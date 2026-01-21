import type { Command } from "commander";

const REQUIRES_PLUGIN_REGISTRY = Symbol.for("clawdbot.requiresPluginRegistry");

type CommandWithPluginRequirement = Command & {
  [REQUIRES_PLUGIN_REGISTRY]?: boolean;
};

export function markCommandRequiresPluginRegistry(command: Command): Command {
  (command as CommandWithPluginRequirement)[REQUIRES_PLUGIN_REGISTRY] = true;
  return command;
}

export function commandRequiresPluginRegistry(command?: Command | null): boolean {
  let current: Command | null | undefined = command;
  while (current) {
    if ((current as CommandWithPluginRequirement)[REQUIRES_PLUGIN_REGISTRY]) return true;
    current = current.parent ?? undefined;
  }
  return false;
}
