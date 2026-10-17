/**
 * A standing observation is recorded once, not once per tick.
 *
 * The reconcile sweep runs on a timer. When a card is eligible for a stage run
 * it does not own, the sweep says so on the card — correct, because the
 * reconciler must not start work on its own. But saying it on every tick buried
 * one card's trail under ten copies of the same line, which is how a real card
 * read when this was found: the trail stops being a record and becomes noise.
 *
 * A faithful harness: comments land in the same table the ledger writes, so the
 * guard is exercised against the real store rather than a counter.
 */
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { createExecutionRun, ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";
import { STAGE_BY_ID } from "../lib/workflow-vocabulary.mjs";
import { createReconcileSweep } from "../server/execution-reconcile-sweep.ts";

const STAGE = Object.entries(STAGE_BY_ID).find(([, entry]) => entry?.execution?.recipe)?.[0];

function makeDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY, status TEXT, worker_thread_id TEXT, stage TEXT)");
  db.exec(
    "CREATE TABLE comments (id TEXT PRIMARY KEY, card_id TEXT, target TEXT, target_id TEXT, author TEXT, body TEXT, created_at INTEGER)",
  );
  ensureExecutionRunTable(db);
  return db;
}

function harness(db, cards) {
  const logged = [];
  const sweep = createReconcileSweep({
    db,
    getCard: (cardId) => cards.find((card) => card.id === cardId),
    cardWorkspace: async () => null,
    logComment: (cardId, targetId, body) => {
      logged.push({ cardId, body });
      db.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(`cmt_${logged.length}`, cardId, "card", targetId, "agent", body, Date.now());
    },
    publishCard: () => {},
    native: {},
    lifecycle: { stopOwned: async () => {} },
    run: { reconcileOne: async () => {} },
  });
  return { sweep, logged };
}

function card(id, stage) {
  return { id, status: "in-progress", worker_thread_id: `thr_${id}`, stage };
}

test("the missing-run observation is recorded once, not once per tick", async () => {
  assert.ok(STAGE, "the vocabulary must expose a stage with an execution recipe");
  const db = makeDb();
  const one = card("card_1", STAGE);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run(one.id, one.status, one.worker_thread_id, one.stage);
  const { sweep, logged } = harness(db, [one]);

  await sweep.reconcileStageEntries();
  await sweep.reconcileStageEntries();
  await sweep.reconcileStageEntries();

  assert.equal(logged.length, 1, "three ticks of one standing gap leave exactly one observation");
  assert.match(logged[0].body, /no .* run for stage /, "and it is the observation, not silence");
});

test("each card owes its own observation", async () => {
  const db = makeDb();
  const a = card("card_a", STAGE);
  const b = card("card_b", STAGE);
  for (const entry of [a, b]) {
    db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run(entry.id, entry.status, entry.worker_thread_id, entry.stage);
  }
  const { sweep, logged } = harness(db, [a, b]);

  await sweep.reconcileStageEntries();
  await sweep.reconcileStageEntries();

  assert.deepEqual(
    logged.map((entry) => entry.cardId).sort(),
    ["card_a", "card_b"],
    "one observation per card, not one per sweep",
  );
});

test("a card that owns its stage run is left alone", async () => {
  const db = makeDb();
  const one = card("card_1", STAGE);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?)").run(one.id, one.status, one.worker_thread_id, one.stage);
  createExecutionRun(db, {
    id: "run_1",
    cardId: one.id,
    projectId: "proj_1",
    recipeId: STAGE_BY_ID[STAGE].execution.recipe,
    stage: STAGE,
    sourceHash: "h",
    sourceText: "s",
    argsText: "{}",
    adapter: "native",
    workspaceId: "ws_1",
    artifactRoot: "/tmp",
    originThreadId: one.worker_thread_id,
  });
  const { sweep, logged } = harness(db, [one]);

  await sweep.reconcileStageEntries();

  assert.deepEqual(logged, [], "an owned stage run raises no observation at all");
});
