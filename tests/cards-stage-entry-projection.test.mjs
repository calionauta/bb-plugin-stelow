import assert from "node:assert/strict";
import { createCardsServer } from "../server/cards.ts";
import { stageEntriesByCard } from "../server/runtime/card-ledger.ts";

/**
 * The gate clock travels on `listCards`, in that one read.
 *
 * The review queue's age is "how long has this card been in this gate", and the
 * only row that knows is `card_stage_events`. Two things follow, and both are
 * pinned here rather than assumed:
 *
 *  1. the entries arrive grouped -- one statement for a whole board, not one per
 *     card on a surface that lists every card;
 *  2. the projection carries `stageEnteredAt` (the card's CURRENT stage, not its
 *     newest move) and `createdAt`, so a caller never has to fetch a second time
 *     or guess from `updatedAt`.
 *
 * The board is the read that already happens; adding a field to it is the whole
 * change. A second read would have been the other way to get this, and it is the
 * one the plan forbids.
 */

const T = Date.UTC(2026, 8, 1, 12, 0, 0);

/** A db that records what was prepared and answers by SQL shape. */
function fakeDb({ stageRows = [], cardRows = [] } = {}) {
  const prepared = [];
  return {
    prepared,
    prepare(sql) {
      prepared.push(sql);
      if (sql.includes("FROM card_stage_events")) {
        return { all: () => stageRows, get: () => undefined, run: () => ({ changes: 0 }) };
      }
      if (sql.includes("FROM cards")) {
        return { all: () => cardRows, get: () => undefined, run: () => ({ changes: 0 }) };
      }
      // Anything else (claims, action log, threads) answers empty rather than
      // exploding: this test is about one projection, not about the schema.
      return { all: () => [], get: () => undefined, run: () => ({ changes: 0 }) };
    },
  };
}

// --- 1. The entries are grouped, and junk rows are dropped ----------------
{
  const db = fakeDb({
    stageRows: [
      { card_id: "card_1", stage: "gate", entered_at: 100 },
      { card_id: "card_1", stage: "diff-gate", entered_at: 200 },
      { card_id: "card_1", stage: "diff-gate", entered_at: 150 },
      { card_id: "card_2", stage: "gate", entered_at: 300 },
      { card_id: null, stage: "gate", entered_at: 1 },
      { card_id: "card_3", stage: "gate", entered_at: null },
    ],
  });
  const entries = stageEntriesByCard(db);
  assert.equal(
    db.prepared.filter((sql) => sql.includes("card_stage_events")).length,
    1,
    "one statement for the whole board: a per-card read is the N+1 this avoids",
  );
  assert.deepEqual(
    [...entries.get("card_1").entries()].sort(),
    [
      ["diff-gate", 200],
      ["gate", 100],
    ],
    "the latest entry per stage, because a card can re-enter a stage it left",
  );
  assert.equal(entries.get("card_2").get("gate"), 300, "each card keeps its own entries");
  assert.equal(entries.has("card_3"), false, "an entry with no timestamp is not an entry");
  assert.equal(entries.size, 2, "rows without a card id are dropped, not grouped under null");
}

// --- 2. listCards carries the clock, from the same read -------------------
function cardRow(overrides = {}) {
  return {
    id: "card_1",
    name: "Queue work",
    display_name: "Queue work",
    prompt: "Ship the queue",
    intent: "feature",
    project_id: "project_1",
    workspace_kind: "project",
    workspace_path: "/repo",
    environment_label: null,
    kind: "build",
    research_strategy: null,
    explore_stage: null,
    status: "running",
    stage: "diff-gate",
    worker_thread_id: null,
    activity: "idle",
    last_error: null,
    last_idle_at: T,
    read_miss_since: null,
    created_at: T - 7 * 86_400_000,
    updated_at: T,
    review_mode: "human",
    ...overrides,
  };
}

function deps(db, cardRows) {
  const stored = {
    getCard: (id) => cardRows.find((row) => row.id === id),
    cardWorkspace: async () => ({ path: "/repo", hostId: null }),
  };
  return {
    db,
    bb: { sdk: { projects: { list: async () => [], get: async () => null } } },
    now: () => T,
    errors: { cardNotFound: "no card", workspaceUnavailable: "no workspace" },
    idleAttentionMs: 86_400_000,
    create: { db },
    loadBoard: async () => ({}),
    githubStatus: async () => ({ available: false }),
    githubAutomationEnabled: () => true,
    store: stored,
    strategyList: () => [],
    getReliablePreset: () => ({ name: "preset", provider_id: "provider", model_id: "model" }),
    fetchPendingQuestions: async () => [],
    openExpiredQuestionIds: () => [],
  };
}

{
  const cardRows = [cardRow()];
  const db = fakeDb({
    cardRows,
    stageRows: [
      // The card left Product Review days ago and entered Code Review an hour
      // ago. The projection must carry the CURRENT stage's entry, not the newest
      // row in the table: a card that re-entered a stage it left has a newer
      // entry for the stage it is not in any more.
      { card_id: "card_1", stage: "gate", entered_at: T - 6 * 86_400_000 },
      { card_id: "card_1", stage: "diff-gate", entered_at: T - 3_600_000 },
      { card_id: "card_1", stage: "execution", entered_at: T },
    ],
  });
  const server = createCardsServer(deps(db, cardRows));
  const result = await server.handlers.listCards({});
  assert.equal(result.cards.length, 1, "one card, one projection");
  const card = result.cards[0];
  assert.equal(
    card.stageEnteredAt,
    T - 3_600_000,
    "the entry for the stage the card is IN, not the newest entry in the trail",
  );
  assert.equal(card.createdAt, T - 7 * 86_400_000, "and the creation time, the fallback clock, on the same read");
  assert.equal(
    db.prepared.filter((sql) => sql.includes("card_stage_events")).length,
    1,
    "the whole projection costs one extra statement, not one per card",
  );
}

// --- 3. A card with no entry says so -------------------------------------
{
  const cardRows = [cardRow({ id: "card_2", stage: "gate" })];
  const db = fakeDb({ cardRows, stageRows: [] });
  const server = createCardsServer(deps(db, cardRows));
  const result = await server.handlers.listCards({});
  assert.equal(result.cards[0].stageEnteredAt, null, "no entry is null, not the creation time and not now");
  assert.equal(result.cards[0].createdAt, T - 7 * 86_400_000, "the fallback is still carried");
}

console.log("cards stage-entry projection test ok");
