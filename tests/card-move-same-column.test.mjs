import assert from "node:assert/strict";
import { test } from "node:test";
import { createCardOperationsHandlers } from "../server/runtime/card-operations.ts";
import { PHASE_ENTRY_STAGES, WORKFLOW_STAGES } from "../lib/workflow-vocabulary.mjs";

/**
 * A drag that changes nothing must change nothing.
 *
 * Found by trying to un-archive a card during a live test and hitting the
 * terminality guard, which sent me looking at the guard's shape. It refuses
 * every move that TOUCHES an archived card, not every move that takes one OUT
 * of archived — so dropping a card onto the column it already occupies came
 * back "This card is archived". Harmless there, and the guard did its job.
 *
 * The same over-broad shape was not harmless one layer down. `movePhase` writes
 * the phase's ENTRY stage unconditionally, so a card being worked right now —
 * `plan-gate`, the last stage of planning — lost its place and was teleported
 * back to `critique` when the reader nudged it a few pixels and let go in the
 * same column. It reported `ok: true`. There was no confirm and nothing to undo.
 *
 * So: a move to where the card already is is a silent no-op, and a move to the
 * phase the card is already inside refuses with the stage it is at and the stage
 * a re-entry would impose. Stage progress moves by doing the work; going back is
 * the explicit restart affordance, which confirms and says what it discards.
 */

const STAGE_PHASES = Object.fromEntries(WORKFLOW_STAGES.map(({ id, phase }) => [id, phase]));

function build(card) {
  const writes = [];
  const stops = [];
  const handlers = createCardOperationsHandlers({
    db: { prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }) },
    bb: { realtime: { publish: () => {} }, sdk: { threads: { send: async () => ({}) } } },
    getCard: () => card,
    workers: {
      fresh: async () => ({ ok: true, error: null }),
      stop: async (threadId) => stops.push(threadId),
    },
    updateCard: (cardId, values) => writes.push({ cardId, values }),
    releaseClaims: async () => {},
    recordStageEvent: () => {},
    cardStageSlug: async () => null,
    fetchPendingAsks: async () => [],
    openExpiredQuestionIds: () => [],
    logCardComment: () => "comment",
    resetAutoContinue: () => ({ count: 0, stage: null }),
    buildNudge: () => "",
    buildContinueInput: () => ({}),
    splitRequestNudge: "",
    phaseEntryStages: PHASE_ENTRY_STAGES,
    stagePhases: STAGE_PHASES,
    errors: { cardNotFound: "Card not found.", cardArchived: "This card is archived." },
  });
  return { handlers, writes, stops };
}

function card(overrides) {
  return {
    id: "card_1",
    kind: "build",
    status: "in-progress",
    stage: "critique",
    worker_thread_id: "thread_1",
    worker_preset_id: null,
    last_error: null,
    attachments: "[]",
    dir_hash: null,
    ...overrides,
  };
}

// The reproduced bug: a card mid-planning, dropped on the Planning column.
test("a card further along a phase is not rewound by a drop on its own column", async () => {
  const { handlers, writes } = build(card({ stage: "plan-gate" }));
  const outcome = await handlers.moveCard({ cardId: "card_1", status: "planning" });
  assert.equal(outcome.ok, false, "a re-entry is refused, not performed");
  assert.deepEqual(writes, [], "and nothing is written — the card keeps its stage");
  assert.match(
    outcome.error ?? "",
    /already in planning \(at plan-gate\)/,
    "the refusal says which phase the card is in and which stage",
  );
  assert.match(
    outcome.error ?? "",
    new RegExp(`reset it to ${PHASE_ENTRY_STAGES.planning}`),
    "and what re-entering would cost, so the reader can choose restart instead",
  );
  assert.match(outcome.error ?? "", /restart it instead/i, "and names the way through that confirms");
});

// The same, for every phase: the entry stage is the only stage where a drop on
// its own column is a genuine no-op.
test("a drop on the column a card already sits in writes nothing, in every phase", async () => {
  for (const [phase, entry] of Object.entries(PHASE_ENTRY_STAGES)) {
    const atEntry = build(card({ stage: entry }));
    const outcome = await atEntry.handlers.moveCard({ cardId: "card_1", status: phase });
    assert.equal(outcome.ok, true, `a card at ${phase}'s entry stage accepts the drop`);
    assert.deepEqual(atEntry.writes, [], `and writes nothing (${phase})`);
    const past = WORKFLOW_STAGES.filter((s) => s.phase === phase && s.id !== entry);
    assert.ok(past.length > 0, `${phase} must have a stage beyond its entry, or this proves nothing`);
    for (const stage of past) {
      const deeper = build(card({ stage: stage.id }));
      const refused = await deeper.handlers.moveCard({ cardId: "card_1", status: phase });
      assert.equal(refused.ok, false, `${phase}/${stage.id} must not be re-entered`);
      assert.deepEqual(deeper.writes, [], `and must not be written (${phase}/${stage.id})`);
    }
  }
});

// A real move still works, and still writes.
test("a genuine move into another phase still lands", async () => {
  const { handlers, writes } = build(card({ stage: "plan-gate" }));
  const outcome = await handlers.moveCard({ cardId: "card_1", status: "execution" });
  assert.equal(outcome.ok, true);
  assert.deepEqual(writes, [
    { cardId: "card_1", values: { stage: PHASE_ENTRY_STAGES.execution, status: "in-progress" } },
  ], "the fix refuses a re-entry, not a move");
});

// Archived stays terminal — that rule is load-bearing and is not what changed.
test("archived is still terminal, but a drop on archived is a no-op", async () => {
  const out = build(card({ status: "archived", stage: "done" }));
  const refusal = await out.handlers.moveCard({ cardId: "card_1", status: "completed" });
  assert.equal(refusal.ok, false, "nothing takes a card out of archived");
  assert.equal(refusal.error, "This card is archived.");
  assert.deepEqual(out.writes, [], "and the refusal writes nothing");

  const noop = await out.handlers.moveCard({ cardId: "card_1", status: "archived" });
  assert.equal(noop.ok, true, "a card already archived accepts a drop on the archived column");
  assert.deepEqual(out.writes, [], "which still writes nothing — no worker stopped for nothing");
  assert.deepEqual(out.stops, [], "and no worker is stopped, which is the side effect that mattered");
});

// Lightweight cards move by status, so the same-column case is a status match.
test("a lightweight card dropped on its own column writes nothing", async () => {
  const { handlers, writes } = build(card({ kind: "research", status: "in-progress" }));
  const outcome = await handlers.moveCard({ cardId: "card_1", status: "doing" });
  assert.equal(outcome.ok, true, "Doing is where an in-progress research card already lives");
  assert.deepEqual(writes, [], "so it is a no-op");
  const real = await handlers.moveCard({ cardId: "card_1", status: "archived" });
  assert.equal(real.ok, true, "and a real move still happens");
  assert.equal(writes.length, 1);
});
