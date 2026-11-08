/**
 * The single predicate for "this title is still unsettled".
 *
 * Both consumers — the Start-time re-fire in `server/workers.ts` and the
 * prompt-save refresh in `server/runtime/card-mutations.ts` — ask this one
 * function instead of each inventing its own comparison. A title counts as
 * unsettled exactly when it still equals what `heuristicDisplayName` would
 * produce from the current prompt: anything else is either burst-improved
 * or human-set, and neither is ever overwritten.
 */
import { heuristicDisplayName } from "./draft-burst.mjs";

export function needsNaming(input) {
  const record = input && typeof input === "object" ? input : {};
  const current = typeof record.displayName === "string" ? record.displayName : "";
  if (current.length === 0) return false;
  const fallback = typeof record.name === "string" && record.name.length > 0 ? record.name : "stelow";
  return current === heuristicDisplayName(record.prompt, fallback);
}
