import assert from "node:assert/strict";
import test from "node:test";
import { resolveCardMove } from "../lib/card-move.mjs";
import { STAGE_SEQUENCE, WORKFLOW_PHASES, WORKFLOW_STAGES } from "../lib/workflow-vocabulary.mjs";

// Every stage belongs to exactly one phase, so the card's position is always
// answerable from its stage alone. This file exists because it was not: the
// resolver took (kind, target) and had no idea where the card was, so every
// phase was reachable from every stage. A card in `triage` could be dropped on
// `review` and the handler wrote the review entry stage and spawned a worker
// there — past shape, critique, planning and every gate, with nothing downstream
// able to tell, because the gates check the artifact they are ABOUT rather than
// the path taken to reach them.
const STAGE_PHASES = Object.fromEntries(WORKFLOW_STAGES.map(({ id, phase }) => [id, phase]));
const PHASES = WORKFLOW_PHASES.map(({ id }) => id);
const at = (stage, target) =>
  resolveCardMove("build", target, { hasWorker: true, stage, stagePhases: STAGE_PHASES });

test("every stage maps to a phase, so a card's position is never unknowable", () => {
  const orphans = WORKFLOW_STAGES.filter(({ phase }) => !phase);
  assert.deepEqual(orphans, [], "a stage with no phase cannot be order-checked");
  // The guard deliberately moves a card whose phase is unknown, because a guard
  // that silently unlocks on missing data is not a guard. This pins the
  // fallback so nobody "hardens" it into a silent allow later.
  const unknown = resolveCardMove("build", "review", { hasWorker: true, stage: "not-a-stage" });
  assert.equal(unknown.ok, true, "an unanswerable position must not deadlock the board");
});

test("a phase more than one ahead refuses, and names what to do instead", () => {
  for (const [stage, target] of [["triage", "execution"], ["triage", "review"], ["select", "review"]]) {
    const result = at(stage, target);
    assert.equal(result.ok, false, `${stage} -> ${target} must refuse`);
    // A refusal that names no exit is a deadlock with a good error message.
    assert.match(result.error, /one phase at a time|let the worker advance/,
      `${stage} -> ${target} must name the way forward`);
    assert.match(result.error, new RegExp(stage), "the refusal must say where the card actually is");
  }
});

test("a phase behind the card refuses, and names the restart affordance", () => {
  for (const [stage, target] of [["critique", "analysis"], ["execution", "analysis"], ["diff-gate", "planning"]]) {
    const result = at(stage, target);
    assert.equal(result.ok, false, `${stage} -> ${target} must refuse`);
    assert.match(result.error, /cannot rewind|restart/i, `${stage} -> ${target} must name the exit`);
    assert.match(result.error, /discards the stages/, "the refusal must say what the rewind would cost");
  }
});

test("the next phase is the only forward move a drag may make", () => {
  for (const [stage, target] of [["triage", "planning"], ["setup", "planning"], ["critique", "execution"], ["execution", "review"]]) {
    const result = at(stage, target);
    assert.equal(result.ok, true, `${stage} -> ${target} is the next phase and must be allowed`);
    assert.deepEqual(result.move, { type: "phase", phase: target });
  }
});

test("no drag from any stage can ever skip a phase", () => {
  // The property, not the cases above: for every stage and every phase target,
  // the only permitted target is the immediately following one. A table of
  // examples would keep passing while a new stage appeared that nobody covered.

  const allowed = new Set();
  for (const { id: stage } of WORKFLOW_STAGES) {
    for (const target of PHASES) {
      if (at(stage, target).ok) allowed.add(`${STAGE_PHASES[stage]}->${target}`);
    }
  }
  for (const from of PHASES) {
    const next = PHASES[PHASES.indexOf(from) + 1];
    const permitted = [...allowed].filter((edge) => edge.startsWith(`${from}->`));
    assert.deepEqual(permitted, next ? [`${from}->${next}`] : [],
      `from ${from} a drag may only reach ${next ?? "nothing"}`);
  }
});

test("stages inside one phase still cannot reach that same phase", () => {
  // Re-entry writes the phase's ENTRY stage over the card's real one, so a card
  // at `plan-gate` would silently teleport back to `critique` and report success.
  const result = at("plan-gate", "planning");
  assert.equal(result.ok, false);
  assert.match(result.error, /already in planning \(at plan-gate\)/);
});

test("stage order survives: STAGE_SEQUENCE still runs triage first", () => {
  // The guard reasons from PHASES, not from the stage list, so a change to stage
  // order must not be able to quietly contradict the phase order it is checked
  // against.
  assert.equal(STAGE_SEQUENCE[0], "triage");
  const firstPhase = STAGE_PHASES[STAGE_SEQUENCE[0]];
  assert.equal(firstPhase, PHASES[0], "the flow's first stage belongs to the first phase");
});
