import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  approveDevicePairing,
  encodePairingSetupCode,
  listDevicePairing,
  renderQrPngBase64,
  resolvePairingSetupFromConfig,
} from "openclaw/plugin-sdk";
import qrcode from "qrcode-terminal";

function renderQrAscii(data: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(data, { small: true }, (output: string) => {
      resolve(output);
    });
  });
}

type DevicePairPluginConfig = {
  publicUrl?: string;
};

function formatSetupReply(
  payload: { url: string; token?: string; password?: string },
  authLabel: string,
): string {
  const setupCode = encodePairingSetupCode(payload);
  return [
    "Pairing setup code generated.",
    "",
    "1) Open the iOS app → Settings → Gateway",
    "2) Paste the setup code below and tap Connect",
    "3) Back here, run /pair approve",
    "",
    "Setup code:",
    setupCode,
    "",
    `Gateway: ${payload.url}`,
    `Auth: ${authLabel}`,
  ].join("\n");
}

function formatSetupInstructions(): string {
  return [
    "Pairing setup code generated.",
    "",
    "1) Open the iOS app → Settings → Gateway",
    "2) Paste the setup code from my next message and tap Connect",
    "3) Back here, run /pair approve",
  ].join("\n");
}

type PendingPairingRequest = {
  requestId: string;
  deviceId: string;
  displayName?: string;
  platform?: string;
  remoteIp?: string;
  ts?: number;
};

function formatPendingRequests(pending: PendingPairingRequest[]): string {
  if (pending.length === 0) {
    return "No pending device pairing requests.";
  }
  const lines: string[] = ["Pending device pairing requests:"];
  for (const req of pending) {
    const label = req.displayName?.trim() || req.deviceId;
    const platform = req.platform?.trim();
    const ip = req.remoteIp?.trim();
    const parts = [
      `- ${req.requestId}`,
      label ? `name=${label}` : null,
      platform ? `platform=${platform}` : null,
      ip ? `ip=${ip}` : null,
    ].filter(Boolean);
    lines.push(parts.join(" · "));
  }
  return lines.join("\n");
}

export default function register(api: OpenClawPluginApi) {
  api.registerCommand({
    name: "pair",
    description: "Generate setup codes and approve device pairing requests.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const args = ctx.args?.trim() ?? "";
      const tokens = args.split(/\s+/).filter(Boolean);
      const action = tokens[0]?.toLowerCase() ?? "";
      api.logger.info?.(
        `device-pair: /pair invoked channel=${ctx.channel} sender=${ctx.senderId ?? "unknown"} action=${
          action || "new"
        }`,
      );

      if (action === "status" || action === "pending") {
        const list = await listDevicePairing();
        return { text: formatPendingRequests(list.pending) };
      }

      if (action === "approve") {
        const requested = tokens[1]?.trim();
        const list = await listDevicePairing();
        if (list.pending.length === 0) {
          return { text: "No pending device pairing requests." };
        }

        let pending: (typeof list.pending)[number] | undefined;
        if (requested) {
          if (requested.toLowerCase() === "latest") {
            pending = [...list.pending].toSorted((a, b) => (b.ts ?? 0) - (a.ts ?? 0))[0];
          } else {
            pending = list.pending.find((entry) => entry.requestId === requested);
          }
        } else if (list.pending.length === 1) {
          pending = list.pending[0];
        } else {
          return {
            text:
              `${formatPendingRequests(list.pending)}\n\n` +
              "Multiple pending requests found. Approve one explicitly:\n" +
              "/pair approve <requestId>\n" +
              "Or approve the most recent:\n" +
              "/pair approve latest",
          };
        }
        if (!pending) {
          return { text: "Pairing request not found." };
        }
        const approved = await approveDevicePairing(pending.requestId);
        if (!approved) {
          return { text: "Pairing request not found." };
        }
        const label = approved.device.displayName?.trim() || approved.device.deviceId;
        const platform = approved.device.platform?.trim();
        const platformLabel = platform ? ` (${platform})` : "";
        return { text: `✅ Paired ${label}${platformLabel}.` };
      }

      const pluginCfg = (api.pluginConfig ?? {}) as DevicePairPluginConfig;
      const resolved = await resolvePairingSetupFromConfig(api.config, {
        publicUrl: pluginCfg.publicUrl,
        runCommandWithTimeout: api.runtime?.system?.runCommandWithTimeout
          ? async (argv, opts) =>
              await api.runtime.system.runCommandWithTimeout(argv, {
                timeoutMs: opts.timeoutMs,
              })
          : undefined,
      });
      if (!resolved.ok) {
        return { text: `Error: ${resolved.error}` };
      }
      const payload = resolved.payload;
      const authLabel = resolved.authLabel;

      if (action === "qr") {
        const setupCode = encodePairingSetupCode(payload);
        const [qrBase64, qrAscii] = await Promise.all([
          renderQrPngBase64(setupCode),
          renderQrAscii(setupCode),
        ]);
        const dataUrl = `data:image/png;base64,${qrBase64}`;

        const channel = ctx.channel;
        const target = ctx.senderId?.trim() || ctx.from?.trim() || ctx.to?.trim() || "";

        if (channel === "telegram" && target) {
          try {
            const send = api.runtime?.channel?.telegram?.sendMessageTelegram;
            if (send) {
              await send(target, "Scan this QR code with the OpenClaw iOS app:", {
                ...(ctx.messageThreadId != null ? { messageThreadId: ctx.messageThreadId } : {}),
                ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
                mediaUrl: dataUrl,
              });
              return {
                text: [
                  `Gateway: ${payload.url}`,
                  `Auth: ${authLabel}`,
                  "",
                  "After scanning, come back here and run `/pair approve` to complete pairing.",
                ].join("\n"),
              };
            }
          } catch (err) {
            api.logger.warn?.(
              `device-pair: telegram QR send failed, falling back (${String(
                (err as Error)?.message ?? err,
              )})`,
            );
          }
        }

        // Render based on channel capability
        api.logger.info?.(`device-pair: QR fallback channel=${channel} target=${target}`);
        const infoLines = [
          `Gateway: ${payload.url}`,
          `Auth: ${authLabel}`,
          "",
          "After scanning, run `/pair approve` to complete pairing.",
        ];

        // TUI (gateway-client) needs ASCII, WebUI can render markdown images
        const isTui = target === "gateway-client" || channel !== "webchat";

        if (!isTui) {
          // WebUI: markdown image only
          return {
            text: [
              "Scan this QR code with the OpenClaw iOS app:",
              "",
              `![Pairing QR](${dataUrl})`,
              "",
              ...infoLines,
            ].join("\n"),
          };
        }

        // CLI/TUI: ASCII QR only
        return {
          text: [
            "Scan this QR code with the OpenClaw iOS app:",
            "",
            "```",
            qrAscii,
            "```",
            "",
            ...infoLines,
          ].join("\n"),
        };
      }

      const channel = ctx.channel;
      const target = ctx.senderId?.trim() || ctx.from?.trim() || ctx.to?.trim() || "";

      if (channel === "telegram" && target) {
        try {
          const runtimeKeys = Object.keys(api.runtime ?? {});
          const channelKeys = Object.keys(api.runtime?.channel ?? {});
          api.logger.debug?.(
            `device-pair: runtime keys=${runtimeKeys.join(",") || "none"} channel keys=${
              channelKeys.join(",") || "none"
            }`,
          );
          const send = api.runtime?.channel?.telegram?.sendMessageTelegram;
          if (!send) {
            throw new Error(
              `telegram runtime unavailable (runtime keys: ${runtimeKeys.join(",")}; channel keys: ${channelKeys.join(
                ",",
              )})`,
            );
          }
          await send(target, formatSetupInstructions(), {
            ...(ctx.messageThreadId != null ? { messageThreadId: ctx.messageThreadId } : {}),
            ...(ctx.accountId ? { accountId: ctx.accountId } : {}),
          });
          api.logger.info?.(
            `device-pair: telegram split send ok target=${target} account=${ctx.accountId ?? "none"} thread=${
              ctx.messageThreadId ?? "none"
            }`,
          );
          return { text: encodePairingSetupCode(payload) };
        } catch (err) {
          api.logger.warn?.(
            `device-pair: telegram split send failed, falling back to single message (${String(
              (err as Error)?.message ?? err,
            )})`,
          );
        }
      }

      return {
        text: formatSetupReply(payload, authLabel),
      };
    },
  });
}
