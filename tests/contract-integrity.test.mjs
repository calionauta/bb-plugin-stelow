// Integrity of the contract data split across lib/jtbd-contracts.mjs,
// lib/strategy-contracts.mjs, and lib/explore-contracts.mjs.
//
// The slices are pure data, so a split is only honest if the data still means
// what the DSL and the vendored methodology say it means. Five properties are
// checked here, and each one fails if the split drops, renames, or typos an
// entry: a cited `ref` must exist on disk, ids must be unique, every `kind`
// must be one the interpreter dispatches, no check may be one that cannot fail,
// and the word floors are the ones the split started from. Every one of the
// five has a negative control further down, so a green run cannot come from a
// check that never fires.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPLORE_CONTRACTS,
  JTBD_CONTRACTS,
  STRATEGY_CONTRACTS,
  contractForBuildArtifact,
  contractForExplore,
  contractForStrategy,
  contractForSubstep,
} from "../lib/artifact-contracts.mjs";
import { CHECK_KINDS, validateArtifact } from "../lib/artifact-validation.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const ALL_CONTRACTS = [
  ...JTBD_CONTRACTS.map((contract) => ({ id: contract.slug, ...contract })),
  ...STRATEGY_CONTRACTS.map((contract) => ({ id: contract.id, ...contract })),
  ...EXPLORE_CONTRACTS.map((contract) => ({ id: contract.id, ...contract })),
];

function everyCheck(contract) {
  const groups = contract.variants ? contract.variants : [contract];
  return groups.flatMap((group) => group.checks ?? []);
}

// 1. Every cited ref is a file that exists. A typo or a renamed upstream
//    reference file would otherwise silently pass review.
for (const contract of ALL_CONTRACTS) {
  assert.ok(contract.ref.startsWith("skills/"), `${contract.id} cites a skill-relative ref`);
  assert.ok(
    existsSync(join(repositoryRoot, contract.ref)),
    `${contract.id} cites a missing reference file: ${contract.ref}`,
  );
}

// 2. Ids are unique per list — a duplicate would shadow an entry silently,
//    because every lookup returns the first match.
for (const [name, list, key] of [
  ["JTBD_CONTRACTS", JTBD_CONTRACTS, "slug"],
  ["STRATEGY_CONTRACTS", STRATEGY_CONTRACTS, "id"],
  ["EXPLORE_CONTRACTS", EXPLORE_CONTRACTS, "id"],
]) {
  const ids = list.map((entry) => entry[key]);
  assert.equal(new Set(ids).size, ids.length, `${name} has a duplicate id`);
}

// 3. Every kind is one the interpreter dispatches, and every contract carries
//    a depth floor. An unknown kind throws at validation time, so it must be
//    caught here rather than on a live card.
for (const contract of ALL_CONTRACTS) {
  const checks = everyCheck(contract);
  assert.ok(checks.length > 0, `${contract.id} has no checks`);
  for (const check of checks) {
    assert.ok(
      CHECK_KINDS.includes(check.kind),
      `${contract.id} uses an undispatched check kind: ${check.kind}`,
    );
  }
  const floors = (contract.variants ? contract.variants : [contract])
    .map((group) => group.minWords)
    .filter((value) => typeof value === "number");
  assert.ok(floors.length > 0, `${contract.id} has no word floor`);
  assert.ok(floors.every((floor) => floor > 0), `${contract.id} has a non-positive word floor`);
}

// 4. No check that cannot fail. Every kind but one carries a constraint a
//    document can miss: a floor, a ceiling, or a non-empty list of names or
//    needles. An empty one passes every document and still reads as depth
//    coverage in review — the guided() factory shipped exactly that for
//    job-to-be-done. gap-registry is exempt with a reason: a document is
//    allowed to have no gaps, so "no registry" is a pass by design. A kind
//    this table does not know is refused rather than skipped, so widening the
//    DSL cannot quietly leave a kind unguarded.
const FAILABLE_CONSTRAINT = {
  headings: (check) => Number.isFinite(check.min) || Number.isFinite(check.max),
  "named-headings": (check) => Array.isArray(check.names) && check.names.length > 0,
  contains: (check) => Array.isArray(check.needles) && check.needles.length > 0,
  "section-items": (check) => Number.isFinite(check.min) && check.min > 0,
  "field-blocks": (check) => Number.isFinite(check.minBlocks) && check.minBlocks > 0,
  "table-rows": (check) => Number.isFinite(check.min) && check.min > 0,
  "table-columns": (check) => Array.isArray(check.names) && check.names.length > 0,
  "gap-registry": () => true,
};
for (const contract of ALL_CONTRACTS) {
  for (const check of everyCheck(contract)) {
    const constrained = FAILABLE_CONSTRAINT[check.kind];
    assert.equal(
      typeof constrained,
      "function",
      `${contract.id} uses kind ${check.kind}, which has no failability rule here`,
    );
    assert.ok(
      constrained(check),
      `${contract.id} has a ${check.kind} check that cannot fail: `
      + "no floor, no ceiling, and nothing to look for",
    );
  }
}

// 5. The word floors themselves, as they stood before the data moved into
//    these three files. The checks above only prove a floor EXISTS; a number
//    that drifted by 300 words would pass all of them and quietly refuse
//    documents that used to pass. Read from the pre-split
//    lib/artifact-contracts.mjs, not from the slices.
const STRATEGY_FLOORS = [
  ["job-to-be-done", [500]],
  ["business-models", [600]],
  ["evolutionary", [600]],
  ["promotions", [600]],
  ["market-analysis", [800, 500]],
  ["marketplace", [600]],
  ["open-source", [600]],
  ["opportunity-mapping", [1200]],
  ["paywall", [600, 600]],
  ["pricing", [600]],
  ["ads", [500]],
  ["discovery", [600]],
  ["product-health", [500]],
  ["trust-building", [500]],
];
assert.deepEqual(
  STRATEGY_CONTRACTS.map((contract) => [
    contract.id,
    (contract.variants ?? [contract]).map((group) => group.minWords),
  ]),
  STRATEGY_FLOORS,
  "the strategy word floors are the ones the methodology was calibrated against",
);

// Negative controls: each check above must fail on a contract that breaks it.
const validExplore = EXPLORE_CONTRACTS.find((entry) => entry.id === "shape-up");

assert.throws(
  () => validateArtifact("body", { checks: [{ kind: "table-rowz", min: 2 }] }),
  /unknown contract check kind: table-rowz/,
  "an undispatched kind must fail fast rather than pass the document",
);

// A control for the ref check: the real ref exists, a fabricated one does not.
assert.ok(
  existsSync(join(repositoryRoot, validExplore.ref)),
  "control: the real shape-up ref exists on disk",
);
assert.equal(
  existsSync(join(repositoryRoot, "skills/stelow-workflow-shape-up/SKILL-nope.md")),
  false,
  "control: a fabricated ref does not exist, so the ref check can fail",
);

// A control for the dispatch list: a real kind is in it, an invented one is not.
assert.ok(CHECK_KINDS.includes("gap-registry"), "control: a real kind is dispatched");
assert.equal(CHECK_KINDS.includes("headingss"), false, "control: an invented kind is not dispatched");

// A control for the failability rule: each predicate refuses the shape it
// exists to refuse. Weakened to a constant true — the way a rule quietly stops
// biting — these are what fail. Every kind is covered, not just the two the
// job-to-be-done regression happened to need.
for (const [kind, unfailable] of [
  ["headings", { kind: "headings" }],
  ["named-headings", { kind: "named-headings", names: [] }],
  ["contains", { kind: "contains", needles: [] }],
  ["section-items", { kind: "section-items", min: 0 }],
  ["field-blocks", { kind: "field-blocks", minBlocks: 0 }],
  ["table-rows", { kind: "table-rows", min: 0 }],
  ["table-columns", { kind: "table-columns", names: [] }],
]) {
  assert.equal(
    FAILABLE_CONSTRAINT[kind](unfailable),
    false,
    `control: an unfailable ${kind} check is recognised as one`,
  );
  assert.equal(
    typeof FAILABLE_CONSTRAINT[kind],
    "function",
    `control: ${kind} has a failability rule to run`,
  );
}
assert.equal(
  typeof FAILABLE_CONSTRAINT["gap-registry"],
  "function",
  "control: the exempt kind is still covered, not skipped",
);
// The exemption is one entry, not a hole: a kind nobody ruled on is refused.
assert.equal(
  FAILABLE_CONSTRAINT["some-new-kind"],
  undefined,
  "control: an unruled kind has no predicate, so the rule above refuses it",
);

// A control for the pinned floors: the table is a literal read off the
// pre-split file, so a drift in it is a mismatch rather than a silent
// agreement. A copy with one floor 300 words off must not compare equal.
const oneFloorDrifted = STRATEGY_FLOORS.map(([id, floors], index) => (
  index === 0 ? [id, [floors[0] + 300]] : [id, floors]
));
assert.notDeepEqual(
  STRATEGY_CONTRACTS.map((contract) => [
    contract.id,
    (contract.variants ?? [contract]).map((group) => group.minWords),
  ]),
  oneFloorDrifted,
  "control: a 300-word drift in one strategy floor does not compare equal",
);

// The routing helpers still resolve every entry, and the facade re-exports the
// same objects the slices hold (a re-export that copied would drift silently).
for (const contract of JTBD_CONTRACTS) {
  assert.equal(contractForSubstep(contract.slug), contract, `${contract.slug} resolves to its own entry`);
}
for (const contract of STRATEGY_CONTRACTS) {
  assert.equal(contractForStrategy(contract.id), contract, `${contract.id} resolves to its own entry`);
}
for (const contract of EXPLORE_CONTRACTS) {
  assert.equal(contractForExplore(contract.id), contract, `${contract.id} resolves to its own entry`);
}

// Every shape the Build matcher claims to recognize resolves to a real explore
// contract, so a rule pointing at a renamed stage fails here rather than
// leaving the document permanently unmatched (and therefore unvalidated).
for (const path of [
  "plans/spec-product_v1.md",
  "plans/spec-tech_v1.md",
  "interfaces/selected-interface.md",
  "plans/testing-strategy.md",
  "critiques/critique-report.md",
  ".stelow-codebase-critique/critique-report.md",
  ".stelow-ux-critique/live-audit-report.md",
]) {
  const matched = contractForBuildArtifact(path, "");
  assert.ok(matched, `${path} matches a contract`);
  assert.equal(contractForExplore(matched.id), matched, `${path} resolves to a registered explore contract`);
}
assert.equal(
  contractForBuildArtifact("notes.md", "# Execution Critique Report\nsummary").id,
  "execution-critique",
  "the title fallback resolves to a registered explore contract",
);

console.log(
  `contract integrity ok: ${ALL_CONTRACTS.length} contracts cite live refs, unique ids, dispatched kinds, `
  + `no unfailable check, ${STRATEGY_FLOORS.length} strategy floors pinned`,
);
