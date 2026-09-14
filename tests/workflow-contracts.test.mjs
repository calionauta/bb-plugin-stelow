import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_TEMPLATE, templateStages } from "../lib/state-template.mjs";
import { BUILD_BOARD_COLUMNS, BUILD_BOARD_COLUMN_LABELS, BUILD_BOARD_TERMINALS, PHASE_ENTRY_STAGES, PHASE_LABELS, STAGE_BANDS, STAGE_SEQUENCE, STAGE_TO_BAND, WORKFLOW_PHASES, WORKFLOW_STAGES, buildBoardColumnFor, stageLabel } from "../lib/workflow-vocabulary.mjs";

// Workflow contracts: one vocabulary powers template, board, and server.
// Catches stage additions without template cover or a phase/label mapping.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const transitions = readFileSync(
  join(root, "skills/stelow-workflow-orchestrator/references/transitions.md"),
  "utf8",
);
const headers = [...transitions.matchAll(/^### (\S+)\s*$/gm)].map((m) => m[1]);
assert.equal(headers.length, 17, "transitions contract covers 17 stages");

const template = templateStages();
assert.equal(template.length, 17, "template covers 17 stages");
for (const stage of template) {
  assert.ok(headers.includes(stage), `template stage ${stage} exists in transitions.md`);
}

assert.deepEqual([...STAGE_SEQUENCE].sort(), [...headers].sort(), "board order matches the transition contract set");
assert.equal(new Set(STAGE_SEQUENCE).size, STAGE_SEQUENCE.length, "board order has no duplicates");
assert.ok(STATE_TEMPLATE.includes("current_stage: triage"), "template starts at triage");
assert.ok(STATE_TEMPLATE.includes("workflow_id: <workflow-id>"), "template carries immutable workflow ownership");
assert.equal(WORKFLOW_STAGES.length, STAGE_SEQUENCE.length, "one catalog owns the ordered workflow stages");
for (const stage of WORKFLOW_STAGES) {
  assert.equal(stageLabel(stage.id), stage.label, `${stage.id} has one display label`);
  assert.equal(STAGE_TO_BAND[stage.id], stage.phase, `${stage.id} has one phase`);
  assert.ok(PHASE_LABELS[stage.phase], `${stage.id} phase has a user-facing label`);
}

const banded = Object.values(STAGE_BANDS).flat();
for (const stage of STAGE_SEQUENCE) {
  assert.ok(banded.includes(stage), `banded stage ${stage} exists in STAGE_BANDS`);
}

// Board topology is derived from the same phase catalog as the stage map;
// terminal outcomes and manual phase entry checkpoints live beside it.
assert.deepEqual(BUILD_BOARD_COLUMNS, [...WORKFLOW_PHASES.map(({ id }) => id), ...BUILD_BOARD_TERMINALS], "Build board derives phase columns and appends only terminal outcomes");
assert.deepEqual(BUILD_BOARD_TERMINALS, ["completed", "archived"], "Build terminal outcomes have one catalog");
for (const phase of WORKFLOW_PHASES) {
  assert.equal(BUILD_BOARD_COLUMN_LABELS[phase.id], phase.label, `${phase.id} board label is its phase label`);
  assert.equal(STAGE_TO_BAND[PHASE_ENTRY_STAGES[phase.id]], phase.id, `${phase.id} manual entry remains inside that phase`);
}
assert.equal(buildBoardColumnFor({ status: "in-progress", stage: "audit" }), "review", "active Audit belongs to Review");
assert.equal(buildBoardColumnFor({ status: "completed", stage: "audit" }), "completed", "Done is a terminal outcome, not Audit's board phase");
assert.equal(buildBoardColumnFor({ status: "archived", stage: "execution" }), "archived", "Archived overrides the retained checkpoint");

console.log("workflow contracts test ok: one vocabulary, template, board topology, bands, and transitions agree on 17 stages");
