import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_TEMPLATE, templateStages } from "../lib/state-template.mjs";
import { BUILD_BOARD_COLUMNS, BUILD_BOARD_COLUMN_LABELS, BUILD_BOARD_TERMINALS, PHASE_ENTRY_STAGES, PHASE_LABELS, STAGE_BANDS, STAGE_SEQUENCE, STAGE_SKILL, STAGE_TO_BAND, STELOW_UPSTREAM_BASE, WORKFLOW_PHASES, WORKFLOW_STAGES, buildBoardColumnFor, stageLabel, stageSkill, stageSkillUrl } from "../lib/workflow-vocabulary.mjs";

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

// Upstream transparency: one skill per stage, one URL builder, no drift.
// Skill-root URLs only — stage docs move, skill dirs are the stable address.
assert.equal(STELOW_UPSTREAM_BASE, "https://github.com/calionauta/stelow/tree/main/skills", "upstream base has one catalog");
const KNOWN_SKILLS = new Set(["stelow-workflow-orchestrator", "stelow-workflow-shape-up", "stelow-workflow-plan-critique", "stelow-workflow-interface-alternatives", "stelow-workflow-tech-planning", "stelow-workflow-scope-executor", "stelow-workflow-testing-execution", "stelow-workflow-execution-critique"]);
for (const stage of WORKFLOW_STAGES) {
  assert.ok(stage.skill, `${stage.id} names its owning upstream skill`);
  assert.ok(KNOWN_SKILLS.has(stage.skill), `${stage.id} skill ${stage.skill} is a vendored upstream skill`);
  assert.ok(existsSync(join(root, "skills", stage.skill, "SKILL.md")), `${stage.id} skill ${stage.skill} is vendored with SKILL.md`);
  assert.equal(STAGE_SKILL[stage.id], stage.skill, `${stage.id} skill has one map`);
  assert.equal(stageSkill(stage.id), stage.skill, `${stage.id} skill accessor agrees`);
  assert.equal(stageSkillUrl(stage.id), `${STELOW_UPSTREAM_BASE}/${stage.skill}`, `${stage.id} URL derives from base + skill`);
}
assert.equal(stageSkill("nope"), null, "unknown stage has no skill");
assert.equal(stageSkillUrl("nope"), null, "unknown stage has no skill URL");

console.log("workflow contracts test ok: one vocabulary, template, board topology, bands, skill links, and transitions agree on 17 stages");
