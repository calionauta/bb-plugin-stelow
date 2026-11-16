import { expiredDebts } from "../../../lib/gap-debt.mjs";
import { FROZEN_ACCEPTANCE_FILE, parseFrozenAcceptance, sameGitEvidence } from "../../../lib/audit-verification.mjs";
import { doneBuildGates, frozenAcceptanceGates } from "../../../lib/build-gates.mjs";
import { countScopeDialects } from "../../../lib/spec-scope-reader.mjs";
import { isDoneStatus, isSkippedStatus } from "../../../lib/trackables.mjs";
import { frozenGatesEnabled } from "../../scope-batch-gates.js";
import { OWNERSHIP_UNVERIFIED } from "../../../lib/ownership-refusal.mjs";
import { latestSpecTech, loadCardScopes } from "../../scopes.js";
import { refuse, type CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import { text } from "../values.js";
import type { WorkerCard } from "../../workers-types.js";
import { auditTrailRefusal } from "../card-audit-trail.js";
import { join } from "node:path";

/**
 * The reasons a build card cannot be done.
 *
 * Each refusal answers one question — is the document deep enough, did the
 * gap loop close, is the acceptance frozen, does the spec-tech exist — and
 * each names the fix. They are a slice of their own because the file that
 * asks them was already at its line budget, and a file that answers every
 * question in one place grows past what a reader can hold.
 */
export async function documentRefusal(
  deps: CliDeps,
  card: WorkerCard,
): Promise<string | null> {
  const shallow = await deps.docDepths(card).catch(() => []);
  if (shallow.length === 0) return null;
  return shallow
    .map(
      (doc) =>
        `FAIL ${doc.label} (${doc.path}): needs depth — ${doc.failures.join("; ")} — rewrite it, then run done again.`,
    )
    .join("\n");
}

/** Gap-registry loop: a matched execution critique with escalate rows must
 * link every row to an audit-gap scope, and every linked scope must be done —
 * otherwise done would certify known rework as complete. Documented debt past
 * its date rejoins the loop the same way: settled until the date, open after
 * it. No matched critique means no enforcement. */
export async function reworkLoopRefusal(
  deps: CliDeps,
  card: WorkerCard,
): Promise<string | null> {
  const gapState = await deps.gapState(card).catch(() => null);
  if (!gapState?.matched) return null;
  if (gapState.failures.length > 0) return gapState.failures.join("\n");
  const expired = expiredDebts(gapState.gaps, deps.now());
  if (expired.length > 0) {
    return [
      `Build completion is blocked: ${expired.length} documented debt(s) past their expires date — settled debt is not open debt:`,
      ...expired.map((debt) => `- ${debt.description} (past ${debt.expires}${debt.owner ? `, owner ${debt.owner}` : ""})`),
      "Pick one: fix it inline and re-run the critique to reclassify it as fixed;",
      "change its resolution to escalate and run `bb stelow gap-scopes` to re-scope it;",
      "or re-date the expires with an owner and re-verify.",
    ].join("\n");
  }
  const linked = new Set(
    gapState.auditGapScopes
      .map((scope) => scope.gap)
      .filter((gap): gap is string => typeof gap === "string"),
  );
  const unscoped = gapState.escalated.filter((gap) => !linked.has(gap.description));
  if (unscoped.length > 0) {
    return `Build completion is blocked: ${unscoped.length} escalated gap(s) have no rework scope — this card is not done, it loops back: \
run \`bb stelow gap-scopes\`, \`bb stelow advance execution\`, execute the new scopes, re-run \
the critique, then run done again:\n${unscoped.map((gap) => `- ${gap.description}`).join("\n")}`;
  }
  // A skipped rework scope is resolved, not open: `isSkippedStatus` is the
  // documented done-gate treatment (lib/trackables.mjs), and the scope-level
  // gate in lib/completion.mjs already honors it. Without it here, a card that
  // skips a rework scope can never complete — the refusal below would name
  // "finish them" for a scope that was deliberately set aside.
  const pendingRework = gapState.auditGapScopes.filter(
    (scope) => !isDoneStatus(scope.status) && !isSkippedStatus(scope.status),
  );
  if (pendingRework.length === 0) return null;
  return `Build completion is blocked: ${pendingRework.length} audit-gap rework \
scope(s) still open — finish them, then run done again:\n${
    pendingRework.map((scope) => `- ${scope.name} (${scope.status})`).join("\n")
  }`;
}

/** Frozen technical acceptance: a present snapshot opts the card into the
 * lock (baseline, test_map, red_proof, freeze_sha at this HEAD). Absent
 * means no snapshot was ever taken — old cards fail open. Behind the
 * STELOW_FROZEN_GATES kill-switch with the batch gates. Runs after the
 * rework loop (known rework first) and before the live test-run check (the
 * freeze must name the HEAD the run just verified). */
export async function frozenAcceptanceRefusal(
  deps: CliDeps,
  stateDir: string | null,
  headSha: string | null,
): Promise<string | null> {
  if (!frozenGatesEnabled()) return null;
  if (!stateDir) return null;
  const raw = await deps.bb.sdk.files
    .read({ path: join(stateDir, FROZEN_ACCEPTANCE_FILE) })
    .then((file) => file.content)
    .catch(() => null);
  if (raw === null) return null;
  const snapshot = parseFrozenAcceptance(raw) ?? { baseline: null, testMap: null, redProof: null, freezeSha: null };
  return frozenAcceptanceGates({ ...snapshot, headSha });
}

/** Invisible-scopes companion: audit with zero synced scopes but scope
 * blocks in spec-tech means execution ran untracked — done must not certify
 * it. Missing/unreadable specs fail open here; thin specs are owned by the
 * depth gate. Gate order lives in lib/build-gates (first refusal wins). */
export function specTechRefusal(
  projectPath: string | null,
  cardId: string,
  currentStage: string,
  trackedScopes: ReturnType<typeof loadCardScopes>,
): string | null {
  if (!projectPath) return null;
  const specTech = latestSpecTech(projectPath, cardId);
  const specCounts = countScopeDialects(specTech?.content ?? null);
  return doneBuildGates({
    kind: "build",
    stage: currentStage,
    scopes: trackedScopes,
    specMachine: specCounts.machine,
    specHuman: specCounts.human,
    specContent: specTech?.content ?? null,
  });
}

