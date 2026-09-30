import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostHold, type HostHold } from "../../lib/host-hold.mjs";

/**
 * The host's hold on a worker thread, or null when the thread is free.
 *
 * A read that FAILS reads as no hold, and that asymmetry is deliberate. The
 * alternative — treating an unreadable queue as a hold — is the silent-stall
 * failure: the card would sit "waiting on the host" with nothing holding it and
 * nothing to release it. Reading as clear keeps the previous behaviour, which
 * is bounded by MAX_AUTO_CONTINUES and repairs itself on the next tick. A
 * duplicate nudge is noise; a card that never moves again is a lie.
 *
 * The read only runs against an idle thread, so the host's in-flight wait
 * kinds cannot reach here — see the one-rule note in lib/host-hold.mjs.
 */
export async function readHostHold(
  bb: BbPluginApi,
  threadId: string,
): Promise<HostHold | null> {
  try {
    const rows = await bb.sdk.threads.queuedMessages.list({ threadId });
    return hostHold(rows);
  } catch {
    return null;
  }
}
