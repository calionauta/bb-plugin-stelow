/**
 * Worker-failure cause. When a worker thread dies before producing output
 * (e.g. a provider 400 on the very first inference call), the `thread.failed`
 * host event carries `error: null` — the provider-side detail lives only in
 * the thread's `provider/error` events. Without surfacing it, the card sits
 * at Failed with a blank `last_error` and no trail, forcing a manual DB dig.
 *
 * Pure event parsing (no BB host dependency) so the shaping is exercised in
 * node tests. The server fetches the events via `threads.events.list` and
 * stores the returned string as the card's `last_error`.
 */

const PROVIDER_ERROR_TYPE = "provider/error";
const SYSTEM_ERROR_TYPE = "system/error";

const MAX_CAUSE_LENGTH = 180;

/** Truncate a message for card surfaces (pill title, hero sub, inbox). */
export function truncateCause(message) {
  const text = String(message ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.length > MAX_CAUSE_LENGTH ? `${text.slice(0, MAX_CAUSE_LENGTH - 1)}…` : text;
}

/**
 * Shape a raw `provider/error` detail into a short human message.
 * Wire format is `<http-code>: <json-or-text>`, e.g.
 * `400: {"type":"error","message":"Internal server error"}` →
 * `Provider error 400: Internal server error`.
 * Returns null when there is nothing worth storing.
 */
export function summarizeProviderDetail(detail) {
  if (typeof detail !== "string") return null;
  const text = detail.trim();
  if (!text) return null;
  const prefixed = text.match(/^(\d{3})\s*:\s*([\s\S]*)$/);
  if (prefixed) {
    const code = prefixed[1];
    const rest = (prefixed[2] ?? "").trim();
    if (!rest) return `Provider error ${code}`;
    try {
      const parsed = JSON.parse(rest);
      const message = parsed && typeof parsed.message === "string" ? parsed.message.trim() : "";
      if (message) return truncateCause(`Provider error ${code}: ${message}`);
    } catch { /* not JSON — fall through to raw text */ }
    return truncateCause(`Provider error ${code}: ${rest}`);
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
      return truncateCause(parsed.message);
    }
  } catch { /* plain text */ }
  return truncateCause(text);
}

/**
 * Pick the failure cause from thread events (newest first). Prefers the
 * latest `provider/error` detail; falls back to a `system/error` message;
 * returns null when no event names a cause. Never throws on odd shapes.
 */
export function failureCauseFromEvents(events) {
  if (!Array.isArray(events)) return null;
  let systemFallback = null;
  for (const event of events) {
    if (!event || typeof event.type !== "string") continue;
    const data = event.data ?? {};
    if (event.type === PROVIDER_ERROR_TYPE) {
      const cause = summarizeProviderDetail(data.detail);
      if (cause) return cause;
    } else if (event.type === SYSTEM_ERROR_TYPE && systemFallback === null) {
      const raw = typeof data.message === "string" && data.message.trim()
        ? data.message
        : typeof data.detail === "string" && data.detail.trim()
          ? data.detail
          : typeof data.error === "string" && data.error.trim()
            ? data.error
            : "";
      systemFallback = truncateCause(raw);
    }
  }
  return systemFallback;
}
