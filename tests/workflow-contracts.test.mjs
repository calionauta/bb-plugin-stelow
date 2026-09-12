import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_TEMPLATE, templateStages } from "../lib/state-template.mjs";
import { PHASE_LABELS, STAGE_BANDS, STAGE_SEQUENCE, STAGE_TO_BAND, WORKFLOW_STAGES, stageLabel } from "../lib/workflow-vocabulary.mjs";

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

console.log("workflow contracts test ok: one vocabulary, template, board, bands, and transitions agree on 17 stages");
