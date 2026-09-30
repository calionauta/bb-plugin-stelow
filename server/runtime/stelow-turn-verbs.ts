/**
 * What the finished turn actually did, in Stelow's own verbs.
 *
 * The host is shown a worker's prose every day and can act on none of it. What
 * it cannot see is the fact it can act on: whether the last turn ran
 * `bb stelow done`, and whether the gate answered. That difference is why a
 * card could sit at audit with a park that said "resume continues the worker
 * with that instruction" when the instruction had already been tried and
 * refused — the words the worker used to explain it were invisible, and the
 * command it had run was not read.
 *
 * So this is not a classifier over prose. It reads the turn's
 * `item/completed` command executions, which are facts, and it returns `null`
 * for "don't know": no thread, or a failed read. Both `null` cases read as
 * nothing to report rather than as progress or as a refusal — a guess here
 * would put a sentence on a card that nothing supports.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { lastTurnStelowCalls } from "../../lib/auto-continue.mjs";

/** What the last turn ran, or `null` for "don't know". */
export type StelowCalls = ReturnType<typeof lastTurnStelowCalls> | null;

/**
 * The finished turn's Stelow verbs, read once per idle sync.
 *
 * Once, and handed to both readers: two fetches would be two windows, and the
 * card could be described by events that stopped being true between them.
 */
export async function readStelowCalls(
  bb: BbPluginApi,
  threadId: string | null,
): Promise<StelowCalls> {
  if (!threadId) return null;
  try {
    const events = await bb.sdk.threads.events.list({
      threadId,
      order: "desc",
      limit: "100",
      types: ["turn/completed", "turn/started", "item/completed"],
    });
    return lastTurnStelowCalls(events);
  } catch {
    return null;
  }
}