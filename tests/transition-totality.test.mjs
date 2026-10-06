import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGE_SEQUENCE } from "../lib/artifact-groups.mjs";
import { approvalGates, auditTransitionTable, parseTransitionRows } from "../lib/transition-facts.mjs";

/**
 * The transition table is a state machine, not prose: every stage has a way
 * out, every exit leads somewhere that exists, and nothing routes only to
 * itself.
 *
 * This is the "card that stops in the middle" test. The table already had an
 * integrity check (`workflow-contracts.test.mjs`: 18 stages, matching the
 * template and the board), and that check was the reason it looked covered — but
 * it only compared *sets of names*. Nothing asked whether `reject: triage` names
 * a stage that exists, whether a stage that was added had any `next` at all, or
 * whether an exit looped back to itself forever. A stage with a header and no
 * body passes "the stage exists" and strands every card that lands on it, with a
 * refusal that names no door — the exact deadlock the project's own rules forbid.
 *
 * Every finding names its stage, so a failure reads as the fix.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const transitionsPath = join(root, "skills/stelow-workflow-orchestrator/references/transitions.md");
const content = readFileSync(transitionsPath, "utf8");

// The terminal stage is the last of the canonical sequence, injected rather than
// baked into the parser: which stage ends the workflow is a vocabulary fact, and
// this module audits structure, not vocabulary.
const terminal = STAGE_SEQUENCE[STAGE_SEQUENCE.length - 1];
assert.equal(terminal, "audit", "the workflow's terminal stage is the last of the sequence");

// --- 1. The whole audit, as one assertion. ----------------------------------
const audit = auditTransitionTable(content, { terminals: [terminal], stages: STAGE_SEQUENCE });

// Reported as a joined list so a failure shows every stage to fix at once
// instead of the first one the runner happened to reach.
const rendered = audit.findings.map((finding) => `${finding.stage}: ${finding.rule} (${finding.value})`).join("; ");
assert.deepEqual(audit.findings, [], `the transition table strands no card: ${rendered || "clean"}`);
assert.equal(audit.ok, true, "the audit reports itself clean when it has no findings");

// --- 2. The audit covers the whole machine, not a corner of it. -------------
// A parser that silently matched two stages would report "clean" vacuously. This
// is the completeness guard the previous test lacked: it asserts the audit saw
// the real table.
assert.deepEqual(
  [...audit.declared].sort(),
  [...STAGE_SEQUENCE].sort(),
  "the audit parsed every stage the vocabulary declares — a parse that covered fewer stages would pass the assertions above while checking nothing",
);
assert.ok(audit.declared.length === 18, `the table declares 18 stages (got ${audit.declared.length})`);
for (const stage of audit.declared) {
  assert.ok(audit.rows[stage].present, `${stage} has a parseable body, not just a header`);
}

// --- 3. `next` is the forward door, and every non-terminal stage has one. ---
// Stated separately because it is the single rule whose violation is a card
// parked forever, and because a failure should name that symptom.
const noForward = audit.declared.filter(
  (stage) => stage !== terminal && audit.rows[stage].targets.next.length === 0 && audit.rows[stage].targets.accept.length === 0,
);
assert.deepEqual(noForward, [], `every non-terminal stage has a forward exit: ${noForward.join(", ") || "none missing"}`);

// --- 4. A self-transition is legal only beside a real exit. -----------------
// `shape` reworks in place (`rework: shape`) and that is correct — but only
// because it also carries `next: critique`. A stage whose *only* exit is itself
// is a loop that looks like progress.
const selfLoops = audit.declared.filter((stage) => {
  const rows = audit.rows[stage].targets;
  const all = [...rows.next, ...rows.accept, ...rows.reject, ...rows.rework];
  return all.length > 0 && all.every((target) => target === stage);
});
assert.deepEqual(selfLoops, [], `no stage routes only to itself: ${selfLoops.join(", ") || "none"}`);

// --- 4. The forward edge actually moves forward. ----------------------------
// Rule 3 asks that a forward door exists. It does not ask where it leads, and
// adversarial review showed what that misses: `execution next: triage` passes
// every rule above — `triage` exists, `execution` has an exit — while stranding
// every execution card in a backward loop that can never reach `audit`. The
// shipped parser and the vendored engine both accept that table, so nothing else
// in the repository would catch it either.
const order = new Map(STAGE_SEQUENCE.map((stage, index) => [stage, index]));
const backward = [];
for (const stage of audit.declared) {
  const from = order.get(stage);
  if (from === undefined) continue;
  for (const target of [...audit.rows[stage].targets.next, ...audit.rows[stage].targets.accept]) {
    // A self-edge is a rework, which rule 4 handles; `reject`/`rework` are
    // allowed (and expected) to point backward — that is what rejecting means.
    if (target === stage) continue;
    const to = order.get(target);
    if (to !== undefined && to <= from) backward.push(`${stage} -> ${target}`);
  }
}
assert.deepEqual(
  backward,
  [],
  `every forward transition moves forward in the canonical sequence: ${backward.join(", ")}`,
);

// The audit must agree with the parser that actually runs. This is asserted on
// the real file rather than only in the unit fixture below, because the
// disagreement that was found was a divergence between two readers of the SAME
// table: `parseNextStages` reads a stage's whole section, so an edge after the
// closing fence is live in production. A parser that reads only the fence reports
// a dead end that does not exist and misses one that does.
const TABLE = (stage, body) => `### ${stage}\n\`\`\`\n${body}\n\`\`\`\n`;
const EMPTY_ROW = "next: (none)\naccept: (none)\nreject: (none)\nrework: (none)";
const postFence = `${TABLE("alpha", EMPTY_ROW)}next: audit\n\n${TABLE("audit", "next: (done)\nreject: alpha")}`;
assert.deepEqual(
  parseTransitionRows(postFence).alpha.targets.next,
  ["audit"],
  "an edge after the closing fence is still read — the shipped parser reads the whole section, so reading only the fence would disagree with production",
);
assert.deepEqual(
  auditTransitionTable(postFence, { terminals: ["audit"], stages: ["alpha", "audit"] }).findings,
  [],
  "a table that is healthy in production is not reported as a dead end",
);

// --- 4b. Duplicate headers resolve the way the shipped parser resolves them. --
// `parseNextStages` takes the FIRST matching section (`sections.find`), and a
// parser that took the last would audit a different table than the one that runs.
const duplicatedHeader =
  `${TABLE("alpha", "next: audit\naccept: audit\nreject: (none)\nrework: (none)")}\n`
  + `${TABLE("alpha", EMPTY_ROW)}\n`
  + TABLE("audit", "next: (done)\nreject: alpha");
assert.deepEqual(
  parseTransitionRows(duplicatedHeader).alpha.targets.next,
  ["audit"],
  "a duplicated header reads first-wins, matching parseNextStages — last-wins would audit a table that never runs",
);


// The comment-strip is load-bearing and has bitten this codebase before ("\Z is
// a literal Z in JavaScript"). These controls assert the strip works, so a
// future "simplification" that drops it fails here rather than in production.
const parsedShape = parseTransitionRows(content);
assert.ok(parsedShape.shape.targets.rework.includes("shape"), "a rework target survives the parenthesised comment strip");
assert.ok(!parsedShape.shape.targets.rework.includes("rework"), "the word 'rework' from the comment is not mistaken for a stage");
assert.deepEqual(parsedShape.triage.targets.next, ["select"], "a bare target parses without a comment");
assert.ok(
  !parsedShape.triage.targets.reject.some((target) => /none|stays|triage has no gate/.test(target)),
  "a '(none — stays at triage)' comment never becomes a stage named 'none' or 'stays'",
);
assert.deepEqual(
  Object.keys(parseTransitionRows("### Not A Stage\n\n### triage\n```\nnext: select\n```\n")),
  ["triage"],
  "a header that is not a stage id is skipped, never invented as a row",
);
assert.deepEqual(
  parseTransitionRows("### triage\n```\nnext: (none — stays at triage)\n```\n").triage.targets.next,
  [],
  "a prose-only target list parses to empty rather than to a stage named 'none'",
);

// --- 6. Approval gates are read from the table, not from a list. ------------
// `requires_approval: true` is what distinguishes "the card is thinking" from
// "the card is waiting for a person". Reading it from the data means a new
// approval gate is a table change, and the wait-attribution metric cannot drift
// from the machine it measures.
const gates = approvalGates(content);
assert.deepEqual(
  [...gates].sort(),
  ["diff-gate", "gate", "int-gate", "plan-gate"],
  "the four stages that require human approval are read from the table",
);
assert.ok(!gates.includes("triage"), "a stage with '(none)' for its gate is not an approval gate");
assert.ok(!gates.includes("audit"), "the terminal stage does not require approval");

// --- 7. The audit is not vacuous: it fails on every defect it claims to catch.
// Four negative controls, one per rule. Without these, a refactor that made the
// auditor return [] unconditionally would keep this entire file green.
const TRIVIAL = (body) =>
  `### alpha\n\`\`\`\n${body}\n\`\`\`\n\n### audit\n\`\`\`\nnext:      (done)\naccept:    (done)\nreject:    alpha\nrework:    (none)\n\`\`\`\n`;
const stages = ["alpha", "audit"];

assert.ok(
  !auditTransitionTable(TRIVIAL("next:      ghost\naccept:    ghost\nreject:    (none)\nrework:    (none)"), { terminals: ["audit"], stages }).ok,
  "an exit to a stage that does not exist is a finding",
);
assert.ok(
  !auditTransitionTable(TRIVIAL("next:      (none)\naccept:    (none)\nreject:    (none)\nrework:    (none)"), { terminals: ["audit"], stages }).ok,
  "a non-terminal stage with no forward exit is a finding",
);
assert.ok(
  !auditTransitionTable(TRIVIAL("next:      alpha\naccept:    alpha\nreject:    (none)\nrework:    (none)"), { terminals: ["audit"], stages }).ok,
  "a stage whose only exit is itself is a finding",
);
assert.ok(
  !auditTransitionTable("### alpha\n\n### audit\n```\nnext: (done)\n```\n", { terminals: ["audit"], stages }).ok,
  "a stage with a header and no parseable body is a finding",
);
assert.ok(
  auditTransitionTable(TRIVIAL("next:      audit\naccept:    audit\nreject:    (none)\nrework:    (none)"), { terminals: ["audit"], stages }).ok,
  "the same shape is clean when the exit leads somewhere real — so the four findings above come from the defect, not from the fixture",
);

console.log(
  `transition facts ok: ${audit.declared.length} stages, no dead ends, approval gates = ${gates.join(", ")}`,
);
