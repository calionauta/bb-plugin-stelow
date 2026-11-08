import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  ACTION_LOG_DEDUPE_WINDOW_MS,
  ACTION_LOG_DETAIL_LIMIT,
  ensureActionLogTable,
  listActionLog,
  parseSinceDuration,
  pruneActionLog,
  recordActionLog,
  summarizeActionLog,
} from "../lib/action-log.mjs";
import { replayTimeline } from "../lib/action-replay.mjs";

function freshDb() {
  const db = new Database(":memory:");
  ensureActionLogTable(db);
  // Creation is idempotent: the recorder is built before some migration passes.
  ensureActionLogTable(db);
  return db;
}

// ── the closed vocabulary is enforced at the writer, not at the call site ────
{
  const db = freshDb();
  assert.throws(
    () => recordActionLog(db, { kind: "rpc.something-new", outcome: "ok" }),
    /action-log: refused unknown kind/,
  );
  assert.throws(
    () => recordActionLog(db, { kind: "rpc.call", outcome: "great" }),
    /action-log: refused outcome/,
  );
  assert.throws(
    () => recordActionLog(db, { kind: "rpc.call", outcome: "ok", actor: "robot" }),
    /action-log: refused actor/,
  );
  assert.throws(
    () => recordActionLog(db, { kind: "rpc.call", outcome: "error", cause: "Not A Cause" }),
    /action-log: refused cause/,
  );
  assert.throws(
    () => recordActionLog(db, { kind: "rpc.call", outcome: "error", cause: "rpc..double" }),
    /action-log: refused cause/,
  );
  assert.throws(
    () => recordActionLog(db, { kind: "rpc.call", outcome: "ok", cause: "x".repeat(65) }),
    /action-log: refused cause/,
    "a cause is a short code, not a sentence",
  );
  assert.equal(listActionLog(db).length, 0, "a refused entry writes nothing");
}

// ── layer and surface come from the catalog ──────────────────────────────────
{
  const db = freshDb();
  recordActionLog(db, { kind: "rpc.call", outcome: "ok", layer: "effect", at: 1_000 });
  let row = listActionLog(db)[0];
  assert.equal(row.layer, "intent", "layer is derived from the kind, never from the caller");
  assert.equal(row.surface, "rpc", "surface is derived from the kind, never from the caller");

  recordActionLog(db, { kind: "rpc.call", outcome: "ok", surface: "cli", at: 2_000 });
  row = listActionLog(db, { limit: 1 })[0];
  assert.equal(row.surface, "rpc", "a contradicting caller surface is ignored, not stored");

  // The caller's surface is no longer read at all, so an undeclared value
  // cannot make a well-formed kind throw.
  const tolerated = recordActionLog(db, {
    kind: "rpc.call",
    outcome: "ok",
    surface: "telepathy",
    at: 3_000,
  });
  assert.equal(tolerated.occurrences, 1);
  assert.equal(listActionLog(db).length, 3, "the entry is kept, with the catalog surface");
  row = listActionLog(db, { limit: 1 })[0];
  assert.equal(row.surface, "rpc", "an unknown caller surface is ignored too");
}

// ── detail is capped; the event survives regardless ─────────────────────────
{
  const db = freshDb();
  const oversized = "p".repeat(ACTION_LOG_DETAIL_LIMIT + 952);
  const whole = JSON.stringify({ prompt: oversized });
  const result = recordActionLog(db, {
    kind: "cli.call",
    outcome: "ok",
    detail: { prompt: oversized },
    at: 1_000,
  });
  assert.equal(result.occurrences, 1);
  const row = listActionLog(db)[0];
  assert.equal(
    row.detail,
    JSON.stringify({ truncated: true, bytes: whole.length }),
    "an oversized detail is replaced by its size, not stored whole",
  );
  assert.ok(!row.detail.includes("pppp"), "no part of the oversized payload survives");

  const circular = { reason: "loop" };
  circular.self = circular;
  const kept = recordActionLog(db, {
    kind: "cli.call",
    outcome: "error",
    detail: circular,
    at: 2_000,
  });
  assert.equal(kept.occurrences, 1, "an unserializable detail keeps the event");
  assert.equal(
    listActionLog(db, { outcome: "error" })[0].detail,
    '{"unserializable":true}',
    "the payload is lost, the fact is not",
  );
}

// ── dedupe: same condition collapses, distinct facts do not ─────────────────
{
  const db = freshDb();
  const base = 10_000_000;
  const original = { kind: "rpc.call", outcome: "refused", cause: "rpc.validation", cardId: "card_1" };
  const first = recordActionLog(db, { ...original, at: base });
  assert.equal(first.deduped, false);

  const repeated = recordActionLog(db, { ...original, at: base + ACTION_LOG_DEDUPE_WINDOW_MS });
  assert.equal(repeated.id, first.id, "the same condition reuses the row");
  assert.equal(repeated.deduped, true);
  assert.equal(repeated.occurrences, 2);
  let rows = listActionLog(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurrences, 2, "the repeat increments occurrences");
  assert.equal(rows[0].at, base, "the first sighting keeps the original at");
  assert.equal(rows[0].lastAt, base + ACTION_LOG_DEDUPE_WINDOW_MS, "and the last sighting updates last_at");

  const otherCard = recordActionLog(db, { ...original, cardId: "card_2", at: base + 1_000 });
  assert.equal(otherCard.deduped, false, "the same cause on another card is another fact");

  const otherCause = recordActionLog(db, { ...original, cause: "rpc.timeout", at: base + 2_000 });
  assert.equal(otherCause.deduped, false, "a different cause is another fact");

  const noCause = { kind: "rpc.call", outcome: "refused", cardId: "card_1" };
  const noCauseOne = recordActionLog(db, { ...noCause, at: base + 3_000 });
  const noCauseTwo = recordActionLog(db, { ...noCause, at: base + 3_001 });
  assert.equal(noCauseOne.deduped, false);
  assert.equal(noCauseTwo.deduped, false, "no cause means no repeatable condition");
  assert.notEqual(noCauseOne.id, noCauseTwo.id, "two cause-less events stay two rows");

  const outside = recordActionLog(db, {
    ...original,
    at: base + ACTION_LOG_DEDUPE_WINDOW_MS * 2 + 1,
  });
  assert.equal(outside.deduped, false, "outside the window a repeat is a new row");
  assert.notEqual(outside.id, first.id);

  rows = listActionLog(db, { cause: "rpc.validation", cardId: "card_1" });
  assert.equal(rows.length, 2, "the original row and the post-window row are both kept");
  assert.deepEqual(rows.map((row) => row.occurrences), [1, 2]);
}

// ── list: filters, ordering, limit ──────────────────────────────────────────
{
  const db = freshDb();
  const insert = (entry) => recordActionLog(db, entry);
  insert({ kind: "rpc.call", outcome: "ok", cardId: "card_1", at: 100 });
  insert({ kind: "rpc.call", outcome: "refused", cause: "rpc.validation", cardId: "card_1", at: 200 });
  insert({ kind: "cli.call", outcome: "refused", cause: "cli.usage", cardId: "card_2", at: 300 });
  insert({ kind: "stage.entered", outcome: "ok", cardId: "card_1", at: 400 });
  insert({ kind: "host.read-miss", outcome: "skipped", at: 500 });

  assert.deepEqual(listActionLog(db).map((row) => row.at), [500, 400, 300, 200, 100], "rows come newest first");
  assert.deepEqual(
    listActionLog(db, { cardId: "card_1" }).map((row) => row.at),
    [400, 200, 100],
    "card filter narrows to one card",
  );
  assert.deepEqual(listActionLog(db, { kind: "cli.call" }).map((row) => row.at), [300]);
  assert.deepEqual(
    listActionLog(db, { layer: "environment" }).map((row) => row.at),
    [500],
    "layer filter reads the derived column",
  );
  assert.deepEqual(listActionLog(db, { outcome: "refused" }).map((row) => row.at), [300, 200]);
  assert.deepEqual(listActionLog(db, { cause: "rpc.validation" }).map((row) => row.at), [200]);
  assert.deepEqual(listActionLog(db, { since: 300 }).map((row) => row.at), [500, 400, 300], "since is inclusive");
  assert.deepEqual(
    listActionLog(db, { cardId: "card_1", kind: "rpc.call", outcome: "refused" }).map((row) => row.at),
    [200],
    "filters combine",
  );
  assert.deepEqual(listActionLog(db, { limit: 2 }).map((row) => row.at), [500, 400], "limit caps the newest rows");

  // `since` reads last_at, so a deduped row survives a window that starts
  // after its first sighting.
  const db2 = freshDb();
  const repeated = { kind: "rpc.call", outcome: "refused", cause: "rpc.validation" };
  recordActionLog(db2, { ...repeated, at: 100 });
  recordActionLog(db2, { ...repeated, at: 900 });
  assert.equal(listActionLog(db2, { since: 800 }).length, 1, "since filters on the last sighting, not the first");
}

// ── summarize: rows and events are different counts ─────────────────────────
{
  const db = freshDb();
  const repeated = { kind: "rpc.call", outcome: "refused", cause: "rpc.validation", cardId: "card_1" };
  recordActionLog(db, { ...repeated, at: 1 });
  recordActionLog(db, { ...repeated, at: 2 });
  recordActionLog(db, { ...repeated, at: 3 });
  recordActionLog(db, { kind: "rpc.call", outcome: "ok", at: 4 });
  recordActionLog(db, { kind: "cli.call", outcome: "error", cause: "cli.exception", at: 5 });

  const summary = summarizeActionLog(db);
  assert.deepEqual(
    summary[0],
    { kind: "rpc.call", outcome: "refused", rows: 1, events: 3 },
    "occurrences are summed per kind and outcome, most frequent first",
  );
  assert.equal(summary.reduce((sum, entry) => sum + entry.events, 0), 5, "events cover every occurrence");
  assert.equal(summary.reduce((sum, entry) => sum + entry.rows, 0), 3, "rows cover every physical row");
  assert.deepEqual(summarizeActionLog(db, { outcome: "ok" }), [{ kind: "rpc.call", outcome: "ok", rows: 1, events: 1 }]);
}

// ── prune: age, cap, and an honest report ───────────────────────────────────
{
  const db = freshDb();
  const now = 100_000_000;
  recordActionLog(db, { kind: "reconcile.tick", outcome: "ok", cause: "tick.old1", at: now - 5_000 });
  recordActionLog(db, { kind: "reconcile.tick", outcome: "ok", cause: "tick.old2", at: now - 4_000 });
  recordActionLog(db, { kind: "reconcile.tick", outcome: "ok", cause: "tick.new", at: now - 100 });

  const ageOnly = pruneActionLog(db, { now, olderThanMs: 1_000, maxRows: 100 });
  assert.deepEqual(ageOnly, { deleted: 2, kept: 1 }, "age deletion reports both counts");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM action_log").get().n,
    ageOnly.kept,
    "kept equals the rows actually left",
  );
}

{
  const db = freshDb();
  const now = 100_000_000;
  for (let index = 0; index < 5; index += 1) {
    recordActionLog(db, {
      kind: "reconcile.tick",
      outcome: "ok",
      cause: `tick.keep-${index}`,
      at: now - (5 - index) * 1_000,
    });
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM action_log").get().n, 5);
  const capped = pruneActionLog(db, { now, olderThanMs: 60_000, maxRows: 2 });
  const after = db.prepare("SELECT COUNT(*) AS n FROM action_log").get().n;
  assert.equal(after, 2, "the row cap deletes the oldest rows");
  assert.equal(capped.deleted, 3, "the cap's deletions are included in the report");
  assert.equal(capped.kept, 2, "kept mirrors the rows that survived");
  assert.equal(capped.kept, after, "kept must equal the rows actually left");
}

// ── parseSinceDuration: one grammar, no improvisation ───────────────────────
{
  assert.equal(parseSinceDuration("30m"), 30 * 60_000);
  assert.equal(parseSinceDuration("6h"), 6 * 3_600_000);
  assert.equal(parseSinceDuration("7d"), 7 * 86_400_000);
  assert.equal(parseSinceDuration("6w"), 6 * 604_800_000);
  for (const junk of ["6", "h", "6 h", "6m30s", "6H", "0h", "0m", "-6h", "1.5h", "", "   ", "6months"]) {
    assert.equal(parseSinceDuration(junk), null, `${JSON.stringify(junk)} is not a duration`);
  }
  assert.equal(parseSinceDuration(6), null, "a number is not the CLI grammar");
  assert.equal(parseSinceDuration(null), null);
}

// ── replay: one chronological timeline from unordered sources ───────────────
{
  const timeline = replayTimeline({
    action: [
      { at: 300, summary: "third" },
      { at: 100, summary: "first" },
    ],
    comment: [{ at: 200, summary: "second" }],
  });
  assert.deepEqual(timeline.map((row) => row.summary), ["first", "second", "third"], "sources merge by timestamp");
  assert.deepEqual(timeline.map((row) => row.source), ["action", "comment", "action"]);
}

{
  const timeline = replayTimeline({
    zzz: [
      { at: 900, summary: "late key, early entry" },
      { at: 10, summary: "unsorted inside its own source" },
    ],
    aaa: [{ at: 50, summary: "early key, middle entry" }],
  });
  assert.deepEqual(
    timeline.map((row) => row.summary),
    ["unsorted inside its own source", "early key, middle entry", "late key, early entry"],
    "a source arriving out of order cannot reorder the timeline",
  );
}

{
  const timeline = replayTimeline({
    action: [
      { at: 100, summary: "kept" },
      { summary: "missing at" },
      { at: Number.NaN, summary: "NaN at" },
      { at: "300", summary: "string at" },
      { at: 400, summary: "   " },
      { at: 401, summary: "" },
      { at: 402, summary: 42 },
      { at: 403 },
      null,
    ],
    comment: [{ at: 150, summary: "  also kept  ", ref: "comment-1" }],
  });
  assert.deepEqual(
    timeline.map((row) => row.summary),
    ["kept", "also kept"],
    "entries without a finite at or a non-empty summary are dropped",
  );
  assert.equal(timeline[1].ref, "comment-1", "ref travels with the fact");
  assert.equal(timeline[0].ref, null, "a missing ref is null, not undefined");
}

{
  const sources = {
    action: [
      { at: 100, summary: "a" },
      { at: 200, summary: "b" },
      { at: 300, summary: "c" },
      { at: 400, summary: "d" },
    ],
  };
  const summaries = (options) => replayTimeline(sources, options).map((row) => row.summary);
  assert.deepEqual(summaries({ since: 200 }), ["b", "c", "d"], "since is inclusive");
  assert.deepEqual(summaries({ limit: 2 }), ["c", "d"], "limit keeps the newest facts, not the first ones");
  assert.deepEqual(summaries({ since: 200, limit: 2 }), ["c", "d"], "limit applies after since");
  assert.deepEqual(replayTimeline({}, {}), []);
  assert.deepEqual(replayTimeline({ action: undefined }), []);
}

{
  const tied = replayTimeline({
    beta: [{ at: 500, summary: "beta fact" }],
    alpha: [{ at: 500, summary: "alpha fact" }],
  });
  assert.deepEqual(tied.map((row) => row.source), ["alpha", "beta"], "equal timestamps break ties by source name");
}


console.log("action log test ok: vocabulary, detail cap, dedupe, filters, summary, prune, since, replay");
