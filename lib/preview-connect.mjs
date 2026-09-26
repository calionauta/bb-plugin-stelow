/**
 * The Connect side of a preview: whether this server can share a port at all,
 * and the share itself. A share is a BONUS, never a gate — an unpaired server
 * must still run at loopback rather than hang in "starting" waiting for an
 * account. Every call is fail-soft for that reason: a missing tunnel, an
 * unpaired host, or a transient CLI error is answered, not thrown.
 */
import { parseShareExpose } from "./preview-reach.mjs";

/** Connect's own answer moves only when the user pairs; the panel asks often. */
const PAIRED_TTL_MS = 30_000;

export function createConnectBridge({ runConnect, now = () => Date.now(), pairedTtlMs = PAIRED_TTL_MS }) {
  let pairedCache = null;

  /** Connect's answer, read and briefly cached. */
  async function isPaired() {
    if (pairedCache && now() - pairedCache.at < pairedTtlMs) return pairedCache.value;
    const parsed = await runConnect(["status"]).catch(() => null);
    const value = Boolean(parsed && parsed.paired);
    pairedCache = { at: now(), value };
    return value;
  }

  /** The share URL for a port, or null when Connect has none to give. */
  async function exposeUrl(port) {
    const parsed = await runConnect(["expose", String(port)]).catch(() => null);
    return parsed ? parseShareExpose(parsed) : null;
  }

  /** Drop the port's share. Best-effort and idempotent: a missing tunnel is fine. */
  async function unexpose(port) {
    await runConnect(["unexpose", String(port)]).catch(() => null);
  }

  return { isPaired, exposeUrl, unexpose };
}
