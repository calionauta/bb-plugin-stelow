import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STAGE_CATALOG, WORKFLOW_ROUTES } from "../lib/workflow-catalog.mjs";

/**
 * Every gate a mode promises to answer without a person is answerable without
 * one, and every receipt a contract demands is a file some stage declares.
 *
 * The catalog can be internally ugly and still pass `workflow-contracts`
 * (18 stages, matching vocabulary) and `transition-totality` (every stage has
 * an exit). Two shapes hide between those tests and both fail only in
 * production:
 *
 *   - a `human-ask` contract on a stage the mode lists as `no_human_wait`.
 *     Auto promises `selection` never parks; a contract there that only a human
 *     answer satisfies makes the promise false, and the worker either lies
 *     about an answer it does not have or the card stalls at a stage nobody was
 *     asked about.
 *   - a contract whose `receipt` no stage declares as an artifact. The contract
 *     is enforceable, the receipt is writable in principle, and no stage's
 *     methodology tells the worker to write it — so the advance is refused for
 *     a file the workflow never asked for.
 *
 * The mirror check is here too: the helper reads `artifact:` lines from
 * transitions.md, the host reads `stages[].artifacts` from the catalog. Two
 * readers, one rule, and a drift between them tells the worker to write one
 * file and refuses the advance for another.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const transitions = readFileSync(
  join(root, "skills/stelow-workflow-orchestrator/references/transitions.md"),
  "utf8",
);

const modes = WORKFLOW_ROUTES.review_modes ?? {};
const routes = WORKFLOW_ROUTES.intents ?? {};

// A renamed key would turn every loop below into a walk over nothing, and the
// file would report "clean" while checking zero modes — the vacuous green this
// test exists to prevent, in the test itself.
assert.ok(Object.keys(modes).length >= 6, `the catalog declares all six review modes (${Object.keys(modes).length})`);
assert.ok(Object.keys(routes).length >= 5, `the catalog declares every intent route (${Object.keys(routes).length})`);
for (const [mode, config] of Object.entries(modes)) {
  assert.ok(Array.isArray(config.skipped), `${mode} declares its skipped stages as a list`);
  assert.ok(Array.isArray(config.no_human_wait), `${mode} declares its no-human-wait stages as a list`);
}
const stageIds = new Set(STAGE_CATALOG.map((stage) => stage.id));
const declaredArtifacts = new Set(STAGE_CATALOG.flatMap((stage) => stage.artifacts ?? []));

// --- 1. Routes name real stages, and every stage is reachable --------------
for (const [intent, route] of Object.entries(routes)) {
  for (const stage of route) {
    assert.ok(stageIds.has(stage), `the ${intent} route names the real stage ${stage}`);
  }
  const ordered = route.map((stage) => STAGE_CATALOG.find((entry) => entry.id === stage).order);
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered, `the ${intent} route follows stage order`);
}
for (const stage of STAGE_CATALOG) {
  const served = Object.values(routes).some((route) => route.includes(stage.id));
  assert.ok(served, `${stage.id} appears in at least one intent route — an unreachable stage is dead methodology`);
}

// --- 2. A mode that never waits cannot carry a human-ask gate -------------
for (const [mode, config] of Object.entries(modes)) {
  for (const stageId of config.no_human_wait ?? []) {
    const stage = STAGE_CATALOG.find((entry) => entry.id === stageId);
    assert.ok(stage, `${mode} lists the real stage ${stageId} as no-human-wait`);
    const applicable = (stage.questions ?? []).filter((question) => !question.modes || question.modes.includes(mode));
    const humanAsks = applicable.filter((question) => question.kind === "human-ask");
    assert.deepEqual(
      humanAsks.map((question) => question.id),
      [],
      `${mode} promises ${stageId} never waits, so its contracts are agent receipts: ${humanAsks.map((q) => q.id).join(", ")}`,
    );
    assert.ok(applicable.length > 0, `${stageId} declares a contract for ${mode} — a gate with no contract asks nothing`);
  }
}

// --- 3. Every receipt is a file some stage declares ------------------------
for (const stage of STAGE_CATALOG) {
  for (const question of stage.questions ?? []) {
    assert.ok(
      declaredArtifacts.has(question.receipt),
      `${stage.id}/${question.id} demands the receipt ${question.receipt}, which no stage declares as an artifact`,
    );
  }
}

// --- 4. The helper's mirror and the host's catalog agree on pre-conditions --
const mirrorArtifacts = new Map();
for (const section of transitions.split(/^### /m).slice(1)) {
  const stageId = section.split("\n")[0].trim();
  const artifacts = [...section.matchAll(/^artifact:\s*(\S+)\s*$/gm)].map((match) => match[1]);
  mirrorArtifacts.set(stageId, artifacts.sort());
}
for (const stage of STAGE_CATALOG) {
  assert.deepEqual(
    mirrorArtifacts.get(stage.id) ?? [],
    [...(stage.artifacts ?? [])].sort(),
    `${stage.id} declares the same pre-condition artifacts to the helper and to the host`,
  );
}

console.log(
  `workflow catalog reachability ok: ${Object.keys(routes).length} routes, ${Object.keys(modes).length} modes, `
    + `${declaredArtifacts.size} artifacts, no unreachable contract`,
);
