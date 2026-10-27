/**
 * The action log's vocabulary, pinned as behaviour rather than as text.
 *
 * Three questions the log must answer without a human reading prose: WHY a
 * handler refused (a closed cause vocabulary, not the wrapper's one bucket),
 * WHY a stage row exists (created/completed/advance/back, derived from the
 * stage catalog), and WHAT a folded duration series means (max and last,
 * because a max alone cannot tell an outlier from a trend).
 *
 * Each assertion names the regression it would catch. A cause test that only
 * compared strings would pass on a rule list that never fires, so every value
 * is also checked against `isActionCause` — the writer's own gate.
 */
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { isActionCause } from "../lib/action-kinds.mjs";
import { ensureActionLogTable, listActionLog, recordActionLog } from "../lib/action-log.mjs";
import { formatActionDuration } from "../lib/action-replay.mjs";
import {
  CARD_LOG_FIELDS,
  CARD_LOG_IGNORED,
  isLoggedCardField,
  unclassifiedCardFields,
} from "../lib/card-log-fields.mjs";
import { rpcRefusalCause } from "../lib/rpc-refusal-cause.mjs";
import { stageEntryCause } from "../lib/stage-entry-cause.mjs";
import { STAGE_SEQUENCE } from "../lib/workflow-catalog.mjs";
import { runPluginMigrations } from "../server/core-migrations.ts";
import { CLI_EQUIVALENTS } from "../server/runtime/plugin-protocols.ts";

// ── 1. a refusal is named, and every name is a legal cause ──────────────────
//
// The wrapper used to emit one `rpc.refused` row for four different refusals.
// These cases are that regression: each message keeps its own word, and the
// archived-thread case proves the specific rule fires before the generic
// `archived` rule (the message contains both words, so order alone decides).
test("rpc refusals keep a distinct cause per reason", () => {
  const cases = [
    ["HTTP 409: Thread is archived", "rpc.refused.thread-archived"],
    ["Waiting on the host: 3 of 3 running on host x", "rpc.refused.host-hold"],
    ["This card has no worker thread.", "rpc.refused.no-thread"],
    ["No recovery question awaits an answer here.", "rpc.refused.no-question"],
    ["This card is completed — comment on it", "rpc.refused.card-completed"],
    ["This card is archived.", "rpc.refused.card-archived"],
    ['Unknown card "x".', "rpc.refused.not-found"],
    ["rpc input validation failed", "rpc.refused.validation"],
  ];
  for (const [message, expected] of cases) {
    const cause = rpcRefusalCause(message);
    assert.equal(cause, expected, `"${message}" is recorded as ${expected}, not folded into a neighbour`);
    assert.equal(isActionCause(cause), true, `${cause} passes the writer's own cause gate`);
  }
});

test("an unrecognised refusal keeps the plain code", () => {
  for (const message of ["something else", null, undefined, "", 409]) {
    const cause = rpcRefusalCause(message);
    assert.equal(cause, "rpc.refused", `${JSON.stringify(message)} does not invent a reason`);
    assert.equal(isActionCause(cause), true, "the fallback is still a legal cause");
  }
});

// ── 2. a stage row names its direction, from the catalog ────────────────────
test("stage entry cause is derived from the catalog, never guessed", () => {
  // Creation: there was no previous stage.
  for (const from of [null, undefined, ""]) {
    assert.equal(stageEntryCause(from, STAGE_SEQUENCE[0]), "stage.created");
  }

  // Completion wins over direction: "done" is outside the sequence, so a rule
  // that consulted the index first would call this an advance or a back.
  assert.equal(stageEntryCause(STAGE_SEQUENCE[0], "done"), "stage.completed");
  assert.equal(stageEntryCause(STAGE_SEQUENCE.at(-1), "done"), "stage.completed");

  // Two real catalog ids, so a reordered catalog cannot make this vacuous.
  const early = STAGE_SEQUENCE[2];
  const later = STAGE_SEQUENCE[10];
  assert.notEqual(early, later);
  assert.equal(stageEntryCause(early, later), "stage.advance", `${early} -> ${later} moves forward`);
  assert.equal(stageEntryCause(later, early), "stage.back", `${later} -> ${early} is a regression`);

  // An unknown id has no direction; guessing one would be a confident lie.
  assert.equal(stageEntryCause(STAGE_SEQUENCE[0], "not-a-real-stage"), "stage.advance");
  assert.equal(stageEntryCause("not-a-real-stage", STAGE_SEQUENCE[0]), "stage.advance");

  // Staying put is not a regression.
  assert.equal(stageEntryCause(later, later), "stage.advance");
});

// ── 3. every cards column is classified, against the migrated schema ────────
//
// The old allowlist silently ignored any column added after it was written, and
// "the log says nothing" read as "it did not happen". This reads the REAL
// schema after the real migrations: a new column that is in neither list fails
// here, which is the only thing that makes the invariant hold.
function migratedCardsDb() {
  const db = new Database(":memory:");
  const host = {
    storage: {
      migrate: (_database, statements) => {
        for (const statement of statements) db.exec(statement);
      },
    },
  };
  runPluginMigrations(host, db, () => 1);
  return db;
}

test("the card column split covers the migrated schema", () => {
  const db = migratedCardsDb();
  try {
    const columns = db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name);
    assert.ok(columns.length > 0, "the cards table exists, so the invariant is measurable");
    assert.deepEqual(
      unclassifiedCardFields(columns),
      [],
      "a cards column in neither CARD_LOG_FIELDS nor CARD_LOG_IGNORED is silently dropped from the log",
    );
    assert.deepEqual(
      unclassifiedCardFields([...columns, "brand_new_column"]),
      ["brand_new_column"],
      "the check itself is live: an unclassified column is reported, not swallowed",
    );
  } finally {
    db.close();
  }
});

test("the two card column lists are disjoint and every ignore names a reason", () => {
  const overlap = [...CARD_LOG_FIELDS].filter((field) => Object.hasOwn(CARD_LOG_IGNORED, field));
  assert.deepEqual(overlap, [], "a column cannot be both logged and ignored");

  for (const [column, reason] of Object.entries(CARD_LOG_IGNORED)) {
    assert.equal(typeof reason, "string", `${column} carries a reason string`);
    assert.ok(reason.trim().length > 0, `${column} is ignored for a stated reason, not a shrug`);
  }

  assert.equal(isLoggedCardField("status"), true, "status changes what the card IS");
  assert.equal(
    isLoggedCardField("last_assistant_text"),
    false,
    "agent prose is not a log field; the recorder must not keep it",
  );
});

// ── 4. a folded duration keeps the max and the latest ───────────────────────
function durationDb() {
  const db = new Database(":memory:");
  ensureActionLogTable(db);
  return db;
}

function recordDuration(db, at, durationMs) {
  return recordActionLog(db, {
    kind: "rpc.call",
    outcome: "ok",
    cause: "rpc.ok",
    cardId: "card-duration",
    at,
    ...(durationMs === undefined ? {} : { durationMs }),
  });
}

test("a repeat folds to one row carrying the max and the last duration", () => {
  const db = durationDb();
  try {
    recordDuration(db, 1_000, 5);
    recordDuration(db, 2_000, 900);
    const folded = recordDuration(db, 3_000, 2);

    const rows = listActionLog(db);
    assert.equal(rows.length, 1, "same kind/outcome/cause/card inside the window is one row");
    assert.equal(rows[0].occurrences, 3);
    assert.equal(rows[0].durationMs, 900, "the max survives a fast last run");
    assert.equal(rows[0].lastDurationMs, 2, "the last run is visible beside the max");
    assert.equal(folded.deduped, true);
  } finally {
    db.close();
  }
});

test("a repeat with no duration leaves both durations as they were", () => {
  const db = durationDb();
  try {
    recordDuration(db, 1_000, 5);
    recordDuration(db, 2_000, 900);
    recordDuration(db, 3_000, 2);
    recordDuration(db, 4_000);

    const [row] = listActionLog(db);
    assert.equal(row.occurrences, 4, "the durationless repeat still counts");
    assert.equal(row.durationMs, 900, "a durationless repeat cannot lower the max");
    assert.equal(
      row.lastDurationMs,
      2,
      "a durationless repeat has no new duration to report; it must not erase the last one it has",
    );
  } finally {
    db.close();
  }
});

test("formatted duration shows the max, and the last only when they differ", () => {
  assert.equal(formatActionDuration({ durationMs: 900, lastDurationMs: 2 }), " 900ms max · 2ms last");
  assert.equal(formatActionDuration({ durationMs: 900, lastDurationMs: 900 }), " 900ms");
  assert.equal(formatActionDuration({ lastDurationMs: 12 }), " 12ms");
  assert.equal(formatActionDuration({}), "");
  assert.equal(formatActionDuration({ durationMs: null, lastDurationMs: null }), "");
});

// ── 5. the prompt names the one verb with no host equivalent ────────────────
//
// `scripts/stelow next` is the verb a worker reaches for first, and there is no
// `bb stelow next`. The clause is the only thing stopping a model from
// inventing it, so it is pinned by its stable phrases rather than its wording.
test("the CLI clause names scripts/stelow next and forbids inventing a verb", () => {
  assert.equal(typeof CLI_EQUIVALENTS, "string");
  assert.match(CLI_EQUIVALENTS, /`scripts\/stelow next`/, "the clause names the verb by path");
  assert.match(CLI_EQUIVALENTS, /no `bb stelow` equivalent|NO `bb stelow` equivalent/i, "it states the verb has no host equivalent");
  assert.match(
    CLI_EQUIVALENTS,
    /Never invent (a )?`bb stelow <verb>`/,
    "and it forbids inventing a verb that is not in bb stelow help",
  );
});
