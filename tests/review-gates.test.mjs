import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_REVIEW_MODE_TO_GATES, formatReviewGates, legacyLabelForGates, normalizeReviewGates, preReviewArtifactKind, skipReasonForGate } from "../lib/review-gates.mjs";
import { parseWorkflowConfig } from "../lib/workflow-config.mjs";
import { skippedStages } from "../lib/stage-skips.mjs";
import { requiredForStage } from "../lib/question-contracts.mjs";
import { STAGE_SEQUENCE } from "../lib/artifact-groups.mjs";

// Centralize in one normalize function: ladder strings, atoms, flow
// lists, and arrays all land on the same canonical sets.
assert.deepEqual(normalizeReviewGates("Auto"), [], "Auto is the empty set");
assert.deepEqual(normalizeReviewGates("Product Spec + Interface + Scopes"), ["spec", "interface", "scope"], "a ladder rung expands to its atoms");
assert.deepEqual(normalizeReviewGates("interface"), ["interface"], "a single atom stands alone");
assert.deepEqual(normalizeReviewGates("[spec, interface]"), ["spec", "interface"], "the state.md flow list parses");
assert.deepEqual(normalizeReviewGates("[]"), [], "an empty flow list is Auto");
assert.deepEqual(normalizeReviewGates(["tech", "spec"]), ["spec", "tech"], "arrays sort into canonical order");
assert.deepEqual(normalizeReviewGates(["spec", "spec", "bogus"]), ["spec"], "arrays dedupe and drop unknown atoms");
assert.deepEqual(normalizeReviewGates("Bogus"), [], "unknown strings fail open, never invent a wait");
assert.deepEqual(normalizeReviewGates(null), [], "non-strings fail open, never throw");
assert.deepEqual(normalizeReviewGates("[spec, bogus]"), ["spec"], "flow lists drop unknown atoms");

// The compat map works both directions for all six legacy rungs.
for (const [rung, gates] of Object.entries(LEGACY_REVIEW_MODE_TO_GATES)) {
  assert.deepEqual(normalizeReviewGates(rung), gates, `${rung} maps to its set`);
  assert.equal(legacyLabelForGates(gates), rung, "the set maps back to its rung");
}
assert.equal(legacyLabelForGates(["interface"]), null, "novel sets have no ladder label");
assert.equal(legacyLabelForGates(["spec", "tech"]), null, "spec + tech plan has no ladder label");
assert.equal(formatReviewGates(["interface", "spec"]), "[spec, interface]", "state.md renders the canonical flow list");
assert.equal(formatReviewGates([]), "[]", "Auto renders as the empty flow list");

// No-regression guard (the strongest test in the RFC): every legacy rung
// behaves identically whether it arrives as a ladder string or as its
// mapped set — same skipped stages, same required contracts.
const stages = ["selection", "shape", "critique", "scope"];
for (const rung of Object.keys(LEGACY_REVIEW_MODE_TO_GATES)) {
  const gates = normalizeReviewGates(rung);
  const viaString = skippedStages({ kind: "build", intent: "feature", reviewMode: rung, sequence: STAGE_SEQUENCE }).skipped.map((s) => s.stage).sort();
  const viaSet = skippedStages({ kind: "build", intent: "feature", reviewGates: gates, sequence: STAGE_SEQUENCE }).skipped.map((s) => s.stage).sort();
  assert.deepEqual(viaSet, viaString, `${rung}: set skips match ladder skips`);
  for (const stage of stages) {
    for (const appetite of ["Lean", "Core", "Complete"]) {
      const expected = requiredForStage({ stage, reviewMode: rung, appetite }).map((entry) => entry.id).sort();
      const actual = requiredForStage({ stage, reviewMode: gates, appetite }).map((entry) => entry.id).sort();
      assert.deepEqual(actual, expected, `${rung}/${stage}/${appetite}: set contracts match ladder contracts`);
    }
  }
}

// Matrix: every atom on/off across representative stages.
const skippedFor = (gates) => skippedStages({ kind: "build", intent: "feature", reviewGates: gates, sequence: STAGE_SEQUENCE }).skipped.map((s) => s.stage).sort();
assert.deepEqual(skippedFor([]), ["diff-gate", "plan-gate", "selection"], "empty set skips every human gate");
assert.deepEqual(skippedFor(["interface"]), ["diff-gate", "plan-gate"], "interface only waits the interface pick, never the tech or diff gates");
assert.deepEqual(skippedFor(["spec", "tech"]), ["diff-gate", "selection"], "spec + tech plan waits plan-gate without the interface pick");
assert.deepEqual(skippedFor(["spec", "interface", "scope", "tech", "diff"]), [], "the full set waits everywhere");
assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: ["interface"], appetite: "Core" }).map((entry) => entry.id),
  ["interface-pick"],
  "interface alone requires the human pick",
);
assert.deepEqual(
  requiredForStage({ stage: "selection", reviewMode: [], appetite: "Core" }).map((entry) => entry.id),
  ["interface-pick-auto"],
  "empty set requires the agent receipt instead",
);
assert.deepEqual(
  requiredForStage({ stage: "scope", reviewMode: ["spec", "interface"], appetite: "Core" }).map((entry) => entry.id),
  ["scope-adjustment-auto"],
  "no scope atom means the LLM adjusts scope itself",
);
assert.deepEqual(
  requiredForStage({ stage: "scope", reviewMode: ["scope"], appetite: "Core" }).map((entry) => entry.id),
  ["scope-adjustment-confirmed"],
  "scope alone requires human confirmation",
);
assert.deepEqual(requiredForStage({ stage: "selection", reviewMode: ["bogus"], appetite: "Core" }), [{ id: "interface-pick-auto", kind: "agent-receipt", receipt: "interfaces/selected-interface.md" }], "unknown atoms fail open to the agent receipt");

// Fixture state.md files per path (AGENTS.md transitions pattern): what
// seeding writes, the guards read back — storage, contracts, and skips
// agree on every novel set, not just inline blobs.
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fixture = (name) => readFileSync(join(root, "tests/fixtures/review-gates", `${name}.state.md`), "utf8");
  const expectations = {
    auto: { gates: [], pick: ["interface-pick-auto"], skipped: ["diff-gate", "plan-gate", "selection"] },
    "interface-only": { gates: ["interface"], pick: ["interface-pick"], skipped: ["diff-gate", "plan-gate"] },
    "spec-tech": { gates: ["spec", "tech"], pick: ["interface-pick-auto"], skipped: ["diff-gate", "selection"] },
    full: { gates: ["spec", "interface", "scope", "tech", "diff"], pick: ["interface-pick"], skipped: [] },
  };
  for (const [name, expected] of Object.entries(expectations)) {
    const state = fixture(name);
    const stage = state.match(/^current_stage:\s*(\S+)/m)?.[1];
    const { appetite, reviewGates } = parseWorkflowConfig(state, { strict: true });
    assert.deepEqual(reviewGates, expected.gates, `${name} fixture declares its set`);
    assert.deepEqual(
      requiredForStage({ stage, appetite, reviewMode: reviewGates }).map((entry) => entry.id),
      expected.pick,
      `${name} fixture resolves its interface-pick contract`,
    );
    assert.deepEqual(
      skippedStages({ kind: "build", intent: "feature", reviewGates, sequence: STAGE_SEQUENCE }).skipped.map((s) => s.stage).sort(),
      expected.skipped,
      `${name} fixture skips exactly its unselected gates`,
    );
  }
}

// Canonical storage round-trips through state.md blobs.
const blob = `---\nconfig:\n  appetite: Core\n  review_gates: [spec, interface]\n  review_mode: Product Spec + Interface Gates\n---\n`;
assert.deepEqual(parseWorkflowConfig(blob).reviewGates, ["spec", "interface"], "an explicit flow list wins over the ladder string");
assert.deepEqual(parseWorkflowConfig("config:\n  review_mode: Auto\n").reviewGates, [], "a ladder-only blob derives its set");
assert.deepEqual(parseWorkflowConfig("config:\n  review_gates: [tech]\n", { strict: true }).reviewGates, ["tech"], "strict keeps a gates-only declaration");
assert.deepEqual(parseWorkflowConfig("---\nintent: refactor\n---\n", { strict: true }).reviewGates, null, "strict yields null when neither key is declared");

// Set skip reasons name the missing gate, not the rung.
assert.match(skipReasonForGate("selection", []), /interface/, "selection reasons name the interface gate");
assert.match(skipReasonForGate("plan-gate", []), /tech/, "plan-gate reasons name the tech gate");
assert.match(skipReasonForGate("diff-gate", []), /diff/, "diff-gate reasons name the diff gate");

// Pre-review eligibility: gate stages resolve their approveGate artifact
// kind; diff-gate (working tree, no single file) and everything else
// resolve null, never a guess.
assert.equal(preReviewArtifactKind("gate"), "product-spec", "product gate reviews the spec");
assert.equal(preReviewArtifactKind("int-gate"), "interfaces", "interface gate reviews the interfaces");
assert.equal(preReviewArtifactKind("plan-gate"), "tech-plan", "plan gate reviews the tech plan");
assert.equal(preReviewArtifactKind("diff-gate"), null, "diff gate has no single artifact to review");
assert.equal(preReviewArtifactKind("execution"), null, "work stages never pre-review");
assert.equal(preReviewArtifactKind(null), null, "junk never pre-reviews");

// Advance wiring: entering a gate fires the pre-review without waiting,
// and the helper fails silent on every miss — designation, workflow,
// artifact, thin file. Advance never depends on it.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
assert.match(server, /if \(cliCard\) void requestGatePreReview\(cliCard\.id, stage\)\.catch\(\(\) => undefined\);/, "gate entry triggers without waiting");
assert.match(server, /async function requestGatePreReview\(cardId: string, stage: string\)/, "the trigger is one named helper");
const preAt = server.indexOf("async function requestGatePreReview(");
const preEnd = server.indexOf("\n  }\n", preAt);
assert.ok(preAt >= 0 && preEnd > preAt, "the helper body is bounded");
const preBody = server.slice(preAt, preEnd);
assert.ok(preBody.includes("preReviewArtifactKind(stage)"), "eligibility resolves through the lib map, never inline");
assert.ok(preBody.includes("card.kind !== \"build\""), "research and explore never pre-review");
assert.ok(preBody.includes("if (!reviewPreset) return;"), "undesignated reviewers stay silent, exactly like review refuses");
assert.ok(preBody.includes("boardFromRoot(bb, workspace.path, card.dir_hash)"), "artifact resolution mirrors approveGate");
assert.ok(preBody.includes("if (!depth || !depth.pass) return;"), "thin files never spend review budget");
assert.ok(preBody.includes('}, "review")'), "pre-reviews ride the registered review site");
assert.ok(preBody.includes('logCardComment(cardId, "card", cardId, "agent"'), "findings land as a card comment, never a gate file");

console.log("review gates test ok: normalize both directions, legacy no-regression, atom matrix, state.md storage, gate-named reasons");
