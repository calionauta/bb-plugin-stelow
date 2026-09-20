import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { liveWorkerCards, bandForCardKindStage } from "../lib/preset-staleness.mjs";
import { refreshRestartPending } from "../lib/worker-ledger.mjs";
import { resolveReliablePreset } from "../lib/reliable-preset.mjs";

// Preset-staleness fan-out: any preset change (card pin, band, reliable
// override, preset delete) re-evaluates every live worker running under it.
// Filtering is behavioral (real SQLite); the server wiring pins below prove
// each mutating RPC actually calls it. A handler that writes a preset row
// without re-evaluating workers fails here.

// Band mapping: tracks own their band, build stages ride their phase band,
// unknown stages fall back to analysis (never to a throw).
assert.equal(bandForCardKindStage("research", "whatever"), "research", "research owns its band");
assert.equal(bandForCardKindStage("explore", "whatever"), "explore", "explore owns its band");
assert.equal(bandForCardKindStage("build", "triage"), "analysis", "triage rides the analysis band");
assert.equal(bandForCardKindStage("build", "critique"), "planning", "critique rides the planning band");
assert.equal(bandForCardKindStage("build", "no-such-stage"), "analysis", "unknown stages fall back to analysis");

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE cards (id TEXT PRIMARY KEY, kind TEXT NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL, worker_thread_id TEXT, worker_preset_id TEXT, preset_restart_pending INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE card_presets (card_id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, assigned_at INTEGER NOT NULL);
  CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE stage_presets (band TEXT PRIMARY KEY, preset_id TEXT NOT NULL, assigned_at INTEGER NOT NULL);
  CREATE TABLE reliable_preset (id INTEGER PRIMARY KEY CHECK (id = 1), preset_id TEXT NOT NULL, assigned_at INTEGER NOT NULL);
`);
const addCard = (id, kind, stage, status, thread, preset) =>
  db.prepare("INSERT INTO cards (id, kind, stage, status, worker_thread_id, worker_preset_id) VALUES (?, ?, ?, ?, ?, ?)").run(id, kind, stage, status, thread, preset);
addCard("live-build", "build", "triage", "in-progress", "thr_1", "preset_band");
addCard("live-research", "research", "research", "in-progress", "thr_2", "preset_band");
addCard("live-pinned", "build", "triage", "in-progress", "thr_3", "preset_pin");
addCard("archived", "build", "triage", "archived", "thr_4", "preset_band");
addCard("workerless", "build", "triage", "in-progress", null, "preset_band");
db.prepare("INSERT INTO card_presets (card_id, preset_id, assigned_at) VALUES ('live-pinned', 'preset_pin', 1)").run();

// Unfiltered: only live workers on non-archived cards. Archived threads and
// workerless cards keep their state — their flags belong to spawn paths.
assert.deepEqual(
  liveWorkerCards(db, null).map((row) => row.id).sort(),
  ["live-build", "live-pinned", "live-research"],
  "only live workers on live cards are re-evaluated",
);
// Band filter: a band preset change touches exactly that band's workers.
assert.deepEqual(
  liveWorkerCards(db, ["research"]).map((row) => row.id),
  ["live-research"],
  "a research band change ignores build workers",
);
assert.deepEqual(
  liveWorkerCards(db, ["analysis"]).map((row) => row.id).sort(),
  ["live-build", "live-pinned"],
  "a band change includes pinned cards (their flag recomputes harmlessly)",
);
assert.deepEqual(liveWorkerCards(db, ["planning"]), [], "an untouched band matches nothing");

// Composition the server performs on a reliable-override assign: recompute
// each live card's effective preset through the cascade, then refresh the
// flag. Unpinned cards follow the override; pinned cards keep their pin.
const effectiveFor = (cardId) => {
  const pin = db.prepare("SELECT preset_id FROM card_presets WHERE card_id = ?").get(cardId);
  const reliable = db.prepare("SELECT preset_id FROM reliable_preset WHERE id = 1").get();
  const resolved = resolveReliablePreset({ cardPin: pin?.preset_id ?? null, reliableOverride: reliable?.preset_id ?? null, bandPreset: "preset_band", defaultPreset: "preset_default" });
  return resolved.presetId ?? "preset_default";
};
db.prepare("INSERT INTO reliable_preset (id, preset_id, assigned_at) VALUES (1, 'preset_reliable', 1)").run();
for (const card of liveWorkerCards(db, null)) {
  refreshRestartPending(db, card.id, card.worker_thread_id, card.worker_preset_id, effectiveFor(card.id));
}
assert.equal(db.prepare("SELECT preset_restart_pending FROM cards WHERE id = 'live-build'").get().preset_restart_pending, 1, "an unpinned live worker flags restart under a new override");
assert.equal(db.prepare("SELECT preset_restart_pending FROM cards WHERE id = 'live-pinned'").get().preset_restart_pending, 0, "a pinned worker is unaffected by the override");
assert.equal(db.prepare("SELECT preset_restart_pending FROM cards WHERE id = 'archived'").get().preset_restart_pending, 0, "archived cards are never touched");
assert.equal(db.prepare("SELECT preset_restart_pending FROM cards WHERE id = 'workerless'").get().preset_restart_pending, 0, "workerless cards are never touched");

// Server wiring: every preset-mutating RPC fans out through the helper.
// A new preset write path that skips re-evaluation fails here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
function handlerBody(name) {
  const at = server.indexOf(name);
  assert.ok(at >= 0, `${name} exists`);
  const end = server.indexOf("\n    },\n", at);
  assert.ok(end > at, `${name} body is bounded`);
  return server.slice(at, end);
}
const reliableBody = handlerBody("async assignReliablePreset({ presetId }) {");
assert.ok(reliableBody.includes("liveWorkerCards(db, null)"), "reliable assign re-evaluates all live workers");
const bandBody = handlerBody("async setBandPreset({ band, presetId }) {");
assert.ok(bandBody.includes("liveWorkerCards(db, [band])"), "band assign re-evaluates exactly that band's workers");
assert.ok(bandBody.includes("refreshRestartPending(db, card.id,"), "band assign recomputes restart-pending");
const deleteBody = handlerBody("async deletePreset({ id }) {");
assert.ok(deleteBody.includes("liveWorkerCards(db, null)"), "preset delete re-evaluates all live workers (band rows cascade silently)");
assert.match(server, /preset = getReliablePresetForBand\(bandForCardKindStage\(card\.kind, card\.stage\), cardId\);/, "reseed resolves the reliable-tier preset like any fresh start");

console.log("preset staleness test ok: band mapping, live filtering, cascade composition, RPC fan-out");
