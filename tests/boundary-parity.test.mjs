import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRANSITION_KINDS,
  auditStageCatalog,
  auditTransitionTable,
  parseTransitionRows,
} from "../lib/transition-facts.mjs";
import {
  STAGE_CATALOG,
  STAGE_TRANSITIONS,
  WORKFLOW_ROUTES,
  WORKFLOW_STAGES,
} from "../lib/workflow-catalog.mjs";
import { legalMoves, policyConditionHolds } from "../lib/workflow-moves.mjs";

/**
 * Two ways the boundary used to disagree with the helper without anybody
 * noticing, both fixed here and both pinned so the disagreement cannot come back
 * quietly.
 *
 * 1. `annotate` — the fifth transition verb. The helper's parser accepts
 *    `next|accept|reject|rework|annotate`; the vendored table carries
 *    `diff-gate → annotate: execution`; and the host's validator read four kinds
 *    and skipped the fifth. The edge was invisible to the audit that exists to
 *    prove every edge leads somewhere. It is NOT a move: annotate names the
 *    stage a reader may annotate, never a place a card travels to. Both halves
 *    are asserted below, because "the host drops the fifth verb" and "the host
 *    offers a move the helper refuses" are different bugs.
 *
 * 2. An EMPTY `any_of`. The helper (`data/stelow`, `def condition_holds`) says
 *    `if not any_of: return True` — an absent disjunction leaves the conjunction
 *    to decide. The host said the opposite: `Object.entries({}).some(...)` is
 *    `false`, so a policy with a conjunction and no disjunction made the panel
 *    offer a stage the helper refused. Latent only because every policy in
 *    today's catalog carries a disjunction; that is asserted too, so the day one
 *    does not, this test says so.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperSource = readFileSync(join(root, "data", "stelow"), "utf8");
const transitionsTable = readFileSync(
  join(root, "skills/stelow-workflow-orchestrator/references/transitions.md"),
  "utf8",
);

// --- 1a. The host's kind list equals the helper's accepted verbs. ----------
// Read from the helper's own parser, not a copy of it: a sixth verb upstream is
// one line up there and must not need anybody to remember this file.
// The helper owns several alternation regexes (`(skipped|no_human_wait)`, and
// others); the transition one is the one that can route a card, and `next` /
// `accept` are the two verbs that make it so regardless of how many others exist.
const parserLine = helperSource
  .split("\n")
  .find((line) => /re\.match\(r"\^\(/.test(line) && /next\|accept/.test(line));
assert.ok(parserLine, "the pinned helper still parses transition rows with one alternation regex");
const alternation = parserLine.match(/r"\^\(([a-z|]+)\):/);
assert.ok(alternation, `the helper's verb alternation is readable: ${parserLine.trim()}`);
const helperVerbs = alternation[1].split("|").sort();
assert.deepEqual(
  [...TRANSITION_KINDS].sort(),
  helperVerbs,
  "the host validates every transition verb the helper accepts, and no invented ones",
);

// --- 1b. The annotate edge is visible to the offline audit. ----------------
const rows = parseTransitionRows(transitionsTable);
assert.deepEqual(
  rows["diff-gate"]?.targets?.annotate,
  ["execution"],
  "the vendored table's annotate edge is parsed, not skipped",
);
const audit = auditTransitionTable(transitionsTable, {
  terminals: ["audit"],
  stages: WORKFLOW_STAGES.map((stage) => stage.id),
});
assert.deepEqual(audit.findings, [], "the table still strands no card once annotate is read");

// --- 1c. Annotate is a kind, never a move. --------------------------------
// `legalMoves` answers in stage names, not verbs, so the invariant is stated on
// the target: a stage reachable ONLY through an annotate edge must never be
// offered as a move. That is exactly the bug this guards — annotate names a
// stage to annotate, and the panel must not turn it into a place a card goes.
const mostGated = "Product Spec + Interface + Tech Review + Code Diff";
let offeredSomewhere = 0;
for (const stage of WORKFLOW_STAGES.map((entry) => entry.id)) {
  const row = STAGE_TRANSITIONS[stage] ?? {};
  const moveTargets = new Set([
    ...(row.next ?? []),
    ...(row.accept ?? []),
    ...(row.reject ?? []),
    ...(row.rework ?? []),
  ]);
  const annotateOnly = (row.annotate ?? []).filter((target) => !moveTargets.has(target));
  const { allowed } = legalMoves({ intent: "feature", reviewPolicy: mostGated, stage });
  offeredSomewhere += allowed.length;
  for (const target of annotateOnly) {
    assert.ok(
      !allowed.includes(target),
      `${stage} offers ${target}, which only an annotate edge names — annotate is not a move`,
    );
  }
}
assert.ok(offeredSomewhere > 0, "the projection offers moves at all");

// The masked case itself: diff-gate reaches execution through reject, which is
// why dropping annotate never surfaced as a stuck card.
const fromDiffGate = legalMoves({ intent: "feature", reviewPolicy: mostGated, stage: "diff-gate" });
assert.ok(
  fromDiffGate.allowed.includes("execution"),
  "diff-gate reaches execution through reject — the audit's masking case",
);
assert.deepEqual(
  STAGE_CATALOG.find((entry) => entry.id === "diff-gate")?.transitions?.annotate,
  ["execution"],
  "and the annotate edge points at the same stage, which is why the gap stayed invisible",
);

// The runtime projection stays four verbs on purpose: annotate is a transition
// KIND, not a move, and nothing reads it at runtime. Pinned so the omission is a
// decision — the audit reads the raw catalog, where all five verbs live.
assert.deepEqual(
  Object.keys(STAGE_TRANSITIONS["diff-gate"]).sort(),
  ["accept", "next", "reject", "rework"],
  "the move projection carries the four move verbs and no dead fifth entry",
);
const catalogAudit = auditStageCatalog(STAGE_CATALOG, { terminal: "audit" });
assert.deepEqual(
  catalogAudit.findings,
  [],
  "the canonical catalog passes the audit now that annotate targets are checked",
);

// --- 2a. An absent disjunction leaves the conjunction to decide. -----------
const emptyDisjunctionHolds = policyConditionHolds(
  { review_mode: ["Auto"] },
  { review_mode: "Auto" },
);
assert.equal(
  emptyDisjunctionHolds,
  true,
  "a rule with no any_of fires when its conjunction holds — the helper's `if not any_of: return True`",
);
assert.equal(
  policyConditionHolds({ review_mode: ["Auto"] }, { review_mode: "Production" }),
  false,
  "a failing conjunction still refuses, disjunction or not",
);
assert.equal(
  policyConditionHolds(
    { review_mode: ["Auto"], any_of: { quality: ["experimental"] } },
    { review_mode: "Auto", quality: "production" },
  ),
  false,
  "a present disjunction must match, even when the conjunction does",
);
assert.equal(
  policyConditionHolds(
    { review_mode: ["Auto"], any_of: { quality: ["experimental"], exploration_count: ["1"] } },
    { review_mode: "Auto", quality: "production", exploration_count: "1" },
  ),
  true,
  "any member of the disjunction is enough",
);

// --- 2b. Today's catalog keeps the inversion latent. ----------------------
const policies = WORKFLOW_ROUTES.stage_policies ?? [];
assert.ok(policies.length > 0, "the catalog publishes stage policies");
const withoutDisjunction = policies.filter((policy) => {
  const anyOf = policy?.skip?.when?.any_of;
  return !anyOf || Object.keys(anyOf).length === 0;
});
assert.deepEqual(
  withoutDisjunction.map((policy) => policy.stage),
  [],
  "no shipped policy relies on the empty-disjunction branch yet — the day one does, this line explains it",
);

console.log(
  `boundary parity ok: ${helperVerbs.length} transition verbs, annotate audited and never offered, ` +
    `empty any_of matches the helper (${policies.length} policies carry a disjunction today)`,
);
