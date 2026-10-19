import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knownStages, playbookEntries, renderPlaybook, stagePlaybookRelPath } from "../lib/playbook.mjs";
import { recipeOutputs } from "../lib/recipe-catalog.mjs";
import { stageRecipeId } from "../lib/workflow-vocabulary.mjs";
import { stateDirFileEntries } from "../lib/state-dir-files.mjs";

// Regression: workers discovered stage playbooks via `bb skill list | awk`
// pipelines over content-hashed ids — flaky and wasteful. The host serves
// exact paths; the table below is the whole mapping, with a loud fallback.

// Explicit coverage first: every machine stage resolves somewhere, and the
// table agrees with the files actually vendored.
const STAGES = [
  "triage", "select", "setup", "context", "shape", "critique", "gate",
  "scope", "interface", "int-gate", "selection", "architecture", "planning",
  "plan-gate", "execution", "verification", "diff-gate", "audit",
];
assert.deepEqual(knownStages().sort(), STAGES.slice().sort(), "every machine stage has a playbook row");
assert.equal(stagePlaybookRelPath("shape"), "SKILL.md", "skill-owned stages point at the skill's entry file");
assert.equal(stagePlaybookRelPath("context"), "stages/context.md", "file-owned stages point at the file");
assert.equal(stagePlaybookRelPath("select"), "stages/selection.md", "upstream #69: select reclaims the selection file");
assert.equal(stagePlaybookRelPath("selection"), "stages/interface-selection.md", "upstream #69: selection owns the interface-pick file");
assert.equal(stagePlaybookRelPath("nope"), null, "unknown stages fall back instead of inventing a path");

// Real I/O: entries resolve against a real directory tree, never a mock.
const root = mkdtempSync(join(tmpdir(), "playbook-"));
const skills = join(root, "skills");
mkdirSync(join(skills, "stelow-workflow-entry"), { recursive: true });
mkdirSync(join(skills, "stelow-workflow-router"), { recursive: true });
mkdirSync(join(skills, "stelow-workflow-orchestrator", "stages"), { recursive: true });
mkdirSync(join(skills, "stelow-workflow-shape-up"), { recursive: true });
for (const file of [
  "stelow-workflow-entry/SKILL.md",
  "stelow-workflow-router/SKILL.md",
  "stelow-workflow-orchestrator/SKILL.md",
  "stelow-workflow-orchestrator/stages/context.md",
  "stelow-workflow-orchestrator/stages/selection.md",
  "stelow-workflow-orchestrator/stages/interface-selection.md",
  "stelow-workflow-shape-up/SKILL.md",
]) {
  writeFileSync(join(skills, file), "# playbook\n");
}
// A real state dir, so the fixed-name registry is exercised through actual I/O
// rather than a mock. `state.md` exists; the receipts that a card only earns
// later do not.
const stateDir = join(root, "state-dir");
mkdirSync(stateDir, { recursive: true });
writeFileSync(join(stateDir, "state.md"), "# state\n");
function buildEntries(stage) {
  return playbookEntries({
    kind: "build",
    stage,
    stateDir,
    statePath: join(stateDir, "state.md"),
    transitionsPath: join(root, "transitions.md"),
    skillsDir: skills,
  }, existsSync);
}

const build = buildEntries("shape");
assert.deepEqual(
  build.map((entry) => entry.label),
  [
    "state", "transitions", "session-log", "audit", "audit-trail", "invariants",
    "scope-map", "recon-receipt", "gate-receipt", "int-gate-receipt",
    "plan-gate-receipt", "diff-gate-receipt", "state dirs", "entry", "router",
    "orchestrator",
    "stage(shape)",
  ],
  "build order is fixed: state, transitions, the card's fixed-name files, core skills, stage",
);
assert.ok(build.every((entry) => entry.missing === false || entry.label === "state" || entry.label === "transitions"), "vendored skill files resolve; workspace files report honestly");

const fallback = buildEntries("int-gate");
assert.ok(fallback.every((entry) => entry.label !== "stage(int-gate)"), "a stage without a file lists no stage row");

const picked = buildEntries("selection");
const pickedRow = picked.find((entry) => entry.label === "stage(selection)");
assert.ok(pickedRow, "the interface-pick stage lists a stage row");
assert.equal(
  pickedRow.path,
  `${skills}/stelow-workflow-orchestrator/stages/interface-selection.md`,
  "stage(selection) resolves to the orchestrator stages path, not the item-selection file",
);
assert.equal(pickedRow.missing, false, "the vendored interface-selection file resolves");

const research = playbookEntries({ kind: "research", stage: null, statePath: join(root, "state.md"), transitionsPath: join(root, "transitions.md"), skillsDir: skills, strategySkill: "stelow-product-discovery", researchIndexPath: join(root, "research-index.md") }, existsSync);
assert.deepEqual(
  research.map((entry) => entry.label),
  [
    "state", "transitions", "session-log", "audit", "audit-trail", "invariants",
    "scope-map", "recon-receipt", "gate-receipt", "int-gate-receipt",
    "plan-gate-receipt", "diff-gate-receipt", "state dirs", "entry", "router",
    "orchestrator",
    "index", "strategy",
  ],
  "research lists index + strategy and the same fixed-name rows, never a stage",
);
assert.equal(research.find((entry) => entry.label === "strategy").missing, true, "an unsynced strategy skill reports missing instead of silently dropping");

const text = renderPlaybook(build);
assert.ok(text.includes("state: ") && text.includes("stage(shape): "), "rendered playbook names its rows");
assert.ok(text.endsWith("Read in order. Do not search for alternatives."), "rendered playbook closes discovery");
assert.ok(renderPlaybook(research).includes("(missing — broken install"), "missing files fail loud in the render");

// The run's artifact root and its recipe's declared outputs. Measured on the
// live host: 247 of 3348 worker commands reference a run dir or an `exec_` id,
// because the worker could not be told where its own stage writes. This is the
// regression pin: the row must carry the root AND each declared output, and a
// not-yet-written expected file must never be reported as a broken install.
const runRoot = join(root, "runs/exec_probe");
const withRun = playbookEntries({
  kind: "build",
  stage: "verification",
  statePath: join(root, "state.md"),
  transitionsPath: join(root, "transitions.md"),
  skillsDir: skills,
  run: { artifactRoot: runRoot, outputs: ["verification/tests.json", "verification/report.md"] },
}, existsSync);
assert.equal(
  withRun.find((entry) => entry.label === "run")?.path,
  runRoot,
  "the playbook names the current run's artifact root",
);
assert.deepEqual(
  withRun.filter((entry) => entry.label === "run-output").map((entry) => entry.path),
  [join(runRoot, "verification/tests.json"), join(runRoot, "verification/report.md")],
  "every recipe-declared output is printed as a full path under the run root",
);
assert.ok(
  withRun.filter((entry) => entry.label === "run-output").every((entry) => entry.missing === false),
  "an expected output that does not exist yet is not a broken install",
);
assert.ok(
  !buildEntries("shape").some((entry) => entry.label.startsWith("run")),
  "no run root means no run rows at all, never a bare output with nothing above it",
);
assert.deepEqual(
  recipeOutputs("verification"),
  ["verification/tests.json", "verification/ui-review.md", "verification/report.md"],
  "outputs come from the recipe catalog, in task order",
);
assert.deepEqual(recipeOutputs("no-such-recipe"), [], "an unknown recipe declares no outputs, never null");
assert.equal(stageRecipeId("verification"), "verification", "a stage's recipe is read off the catalog");
assert.equal(stageRecipeId("triage"), null, "a direct-execution stage has no recipe");

// The card's fixed-name files. Remaining-fragility #6 in rfc-worker-robustness:
// the host knows the exact paths, so it should tell. These receipts and maps sit
// at a KNOWN name in a KNOWN directory, and workers were rebuilding those paths
// from memory — 23 `audit-trail` commands across the live threads, one of them
// reconstructing `.stelow/<date>/sw-card_<id>/audit-trail.md` by hand.
const fixedState = join(root, "fixed");
mkdirSync(join(fixedState, "context"), { recursive: true });
writeFileSync(join(fixedState, "state.md"), "# state\n");
writeFileSync(join(fixedState, "audit-trail.md"), "# trail\n");
const fixedRows = playbookEntries({
  kind: "build",
  stage: "audit",
  statePath: join(fixedState, "state.md"),
  skillsDir: skills,
}, existsSync).filter((entry) => ["state", "audit-trail", "audit"].includes(entry.label));
assert.deepEqual(
  fixedRows.map((entry) => entry.label),
  ["state", "audit", "audit-trail"],
  "the state dir's fixed-name files are named without a caller passing the dir",
);
// A file that exists is not missing; one a card has not earned yet is NOT
// reported as missing either — that verdict has to stay meaningful.
assert.equal(fixedRows.find((e) => e.label === "audit-trail").missing, false, "a present receipt is not missing");
assert.equal(fixedRows.find((e) => e.label === "audit").missing, false, "an absent conditional receipt is not a broken install");
assert.equal(fixedRows.find((e) => e.label === "state").missing, false, "the state file's verdict is real");

// Without a state dir nothing is invented: a guessed path is worse than a search.
const dirless = playbookEntries({ kind: "build", stage: "audit", skillsDir: skills }, existsSync);
assert.ok(
  !dirless.some((entry) => ["audit-trail", "invariants", "scope-map", "recon-receipt"].includes(entry.label)),
  "no state dir means no fixed-name rows, never a fabricated path",
);
// `recon-receipt` is the one file a recipe writes but never declares, so this
// list is the only way a worker is ever told it exists.
assert.ok(
  fixedState && stateDirFileEntries(fixedState, existsSync).some((entry) => entry.label === "recon-receipt"),
  "the undeclared recon receipt is named",
);

console.log("playbook test ok: stage table, ordered entries, real I/O, loud missing files, run outputs");
