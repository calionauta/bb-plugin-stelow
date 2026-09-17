/**
 * Single decision point for every ask refusal. The ask handler used to run
 * three gates inline (duplicate, intent, evidence) plus a split branch;
 * reordering or editing one risked silently changing the precedence the
 * others relied on. This dispatcher fixes the order once — duplicate,
 * then intent, then evidence — and the server stays a thin caller that
 * only supplies I/O-derived inputs (counts, card, stage) plus the parsed
 * groups. The split branch stays out deliberately: it validates AND
 * persists (split_proposals row, question rewrite), and a dispatcher
 * decides but never executes.
 */
import { questionOpenGuard } from "./question-presence.mjs";
import { contextAskGate } from "./context-ask-gate.mjs";
import { gateEvidenceGate } from "./gate-ask-evidence.mjs";

/**
 * Decide whether an ask may reach the human. Returns { allowed, reason,
 * code }: the first refusal in pipeline order wins; all green returns
 * allowed. Exit codes preserve the handler's contract (1 = transient,
 * retry the same ask once; 2 = refused, do not retry blindly). Pure (no
 * BB host dependency) so the precedence matrix is exercised in node
 * tests. `--force` bypasses intent and evidence gates but never the
 * duplicate guard — a second form while one is answerable is a duplicate
 * regardless of flags.
 */
export function decideAskGate({ liveCount, expiredCount, kind, intent, stage, tag, forced, groups }) {
  const duplicate = questionOpenGuard({ liveInteractions: liveCount ?? 0, expiredQuestions: expiredCount ?? 0 });
  if (!duplicate.canOpen) return { allowed: false, reason: duplicate.reason, code: 1 };
  const context = contextAskGate({ kind, intent, stage, tag, forced });
  if (!context.allowed) return { allowed: false, reason: context.error, code: 2 };
  const evidence = gateEvidenceGate({ kind, stage, tag, forced, groups });
  if (!evidence.allowed) return { allowed: false, reason: evidence.error, code: 2 };
  return { allowed: true, reason: null, code: 0 };
}
