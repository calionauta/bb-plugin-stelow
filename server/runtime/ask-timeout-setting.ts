/**
 * The card question timeout as a plugin setting.
 *
 * Kept out of the composition root so `createRuntimeCore` stays a table of
 * contents. The setting is resolved per ask (a live settings read), and the
 * environment variable remains a test/ops override validated by the pure
 * resolver.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  ASK_TIMEOUT_OPTIONS,
  DEFAULT_ASK_TIMEOUT,
  resolveAskTimeoutMs,
} from "../../lib/ask-timeout.mjs";

export function createAskTimeoutSetting(bb: BbPluginApi) {
  // Older hosts and test harnesses may not expose `settings`; the timeout
  // must still resolve (default + env override) instead of crashing startup.
  const settings = bb.settings?.define
    ? bb.settings.define({
        askTimeout: {
          type: "select",
          label: "Question timeout",
          description:
            "How long a card question waits for an answer before it becomes a recovery question.",
          options: Object.keys(ASK_TIMEOUT_OPTIONS),
          default: DEFAULT_ASK_TIMEOUT,
        },
      })
    : null;
  return {
    askTimeoutMs: async () => {
      const configured = settings
        ? (await settings.get()).askTimeout
        : DEFAULT_ASK_TIMEOUT;
      return resolveAskTimeoutMs(configured, process.env.STELOW_ASK_TIMEOUT_MS);
    },
  };
}
