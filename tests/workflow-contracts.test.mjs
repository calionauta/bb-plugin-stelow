import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_TEMPLATE, templateStages } from "../lib/state-template.mjs";
import { STAGE_SEQUENCE } from "../lib/artifact-groups.mjs";
import { STAGE_BANDS } from "../lib/stage-bands.mjs";

// Workflow contracts: single sources with assertions instead of comments.
// Catches: stage added to transitions without template cover, template or
// board order drifting from the canonical stage set, duplicate stages.
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

const banded = Object.values(STAGE_BANDS).flat();
for (const stage of STAGE_SEQUENCE) {
  assert.ok(banded.includes(stage), `banded stage ${stage} exists in STAGE_BANDS`);
}

console.log("workflow contracts test ok: template, board order, bands, and transitions agree on 17 stages");
