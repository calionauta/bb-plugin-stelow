/**
 * Which card a thread was.
 *
 * The thread→card relation outlives archiving: a stopped thread on an archived
 * card still answers "which card was this", so the thread header keeps its way
 * back. Card detail renders archived cards, so refusing the lookup would strand
 * the user on a thread with no route to the work it did.
 *
 * That is a rule, not a lookup, so it is stated once here and tested directly
 * rather than inferred from a handler's shape.
 */
import { normalizeKind } from "../../lib/tracks.mjs";
import type { WorkerCard } from "../workers-types.js";

export type ThreadCardRow = Pick<WorkerCard, "id" | "kind">;
export type ThreadCardLookup = (
  threadId: string,
) => ThreadCardRow | undefined;

export type CardByWorkerThread = (input: {
  threadId: string;
}) => { cardId: string | null; kind: ReturnType<typeof normalizeKind> | null };

/** The RPC handler: a resolved link, or an honest "no card". */
export function createCardByWorkerThread(
  findByThread: ThreadCardLookup,
): CardByWorkerThread {
  return function cardByWorkerThread({ threadId }) {
    const row = findByThread(threadId);
    if (!row) return { cardId: null, kind: null };
    return { cardId: row.id, kind: normalizeKind(row.kind) };
  };
}
