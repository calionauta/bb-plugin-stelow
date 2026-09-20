import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReliablePreset, RELIABLE_SOURCE_CARD, RELIABLE_SOURCE_OVERRIDE, RELIABLE_SOURCE_BAND, RELIABLE_SOURCE_DEFAULT } from "../lib/reliable-preset.mjs";

// Reliable-tier override: an optional board-level preset that replaces the
// band preset for reliable spawns. Empty means today's behavior — the test
// that would catch a regression that silently re-routes workers (e.g. a
// cascade reorder that lets the band preset beat an explicit pin, or a
// spawn site that bypasses the resolver).

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");

// Cascade order: card pin > reliable override > band > default. A reorder
// here changes which brain runs the worker, so each level is pinned.
assert.deepEqual(
  resolveReliablePreset({ cardPin: "c", reliableOverride: "r", bandPreset: "b", defaultPreset: "d" }),
  { presetId: "c", source: RELIABLE_SOURCE_CARD },
  "the per-card pin beats everything",
);
assert.deepEqual(
  resolveReliablePreset({ cardPin: null, reliableOverride: "r", bandPreset: "b", defaultPreset: "d" }),
  { presetId: "r", source: RELIABLE_SOURCE_OVERRIDE },
  "the reliable override replaces the band preset when set",
);
assert.deepEqual(
  resolveReliablePreset({ cardPin: null, reliableOverride: null, bandPreset: "b", defaultPreset: "d" }),
  { presetId: "b", source: RELIABLE_SOURCE_BAND },
  "empty override falls back to the band preset (today's behavior)",
);
assert.deepEqual(
  resolveReliablePreset({ cardPin: null, reliableOverride: null, bandPreset: null, defaultPreset: "d" }),
  { presetId: "d", source: RELIABLE_SOURCE_DEFAULT },
  "no band preset falls back to the card/board default",
);
assert.deepEqual(
  resolveReliablePreset({ cardPin: "", reliableOverride: "", bandPreset: "", defaultPreset: "" }),
  { presetId: null, source: null },
  "empty strings resolve to nothing, never to a refusal downstream",
);

// Singleton table mirrors the generation_preset discipline: one row,
// cascade-cleared when its preset is deleted.
assert.match(server, /CREATE TABLE IF NOT EXISTS reliable_preset \(\s*\n\s*id INTEGER PRIMARY KEY CHECK \(id = 1\)/, "the reliable designation is a singleton row");
assert.match(server, /FOREIGN KEY \(preset_id\) REFERENCES presets\(id\) ON DELETE CASCADE\s*\n\s*\)`\);[\s\S]*reliable_preset/, "deleting the preset clears the reliable designation");

// Changing the override must flag live workers running under it: provider/
// model are fixed at spawn, so a worker predating the change offers Restart
// instead of a Resume that changes nothing (same contract as assignPreset).
const assignAt = server.indexOf("async assignReliablePreset({ presetId }) {");
assert.ok(assignAt >= 0, "the reliable setter body is found");
const assignEnd = server.indexOf("\n    },\n", assignAt);
assert.ok(assignEnd > assignAt, "the reliable setter body is bounded");
const assignBody = server.slice(assignAt, assignEnd);
assert.ok(assignBody.includes("WHERE worker_thread_id IS NOT NULL"), "only live workers are re-evaluated — workerless cards keep their state");
assert.ok(assignBody.includes("refreshRestartPending(db, card.id,"), "live workers recompute restart-pending against the new effective preset");
// Both the zod contract and the handler must exist — a handler without a
// contract entry fails typecheck, a contract entry without a handler fails
// at runtime.
assert.match(server, /  getReliablePreset: \{\s*\n\s*input: z\.object\(\{\}\)\.strict\(\),/, "the reliable getter is in the RPC contract");
assert.match(server, /  assignReliablePreset: \{\s*\n\s*input: z\.object\(\{ presetId: z\.string\(\)\.nullable\(\) \}\)\.strict\(\),/, "the reliable setter is in the RPC contract");
assert.match(server, /async getReliablePreset\(\) \{/, "the reliable getter RPC exists");
assert.match(server, /async assignReliablePreset\(\{ presetId \}\) \{/, "the reliable setter RPC exists");
assert.match(server, /INSERT OR REPLACE INTO reliable_preset \(id, preset_id, assigned_at\) VALUES \(1, \?, \?\)/, "the setter upserts the singleton row");
assert.match(server, /DELETE FROM reliable_preset WHERE id = 1/, "clearing the override deletes the singleton row");

// The resolver lives beside getPresetForBand — never inside it — so the
// draft-burst band fallback keeps resolving the pure band preset.
assert.match(server, /function getReliablePresetForBand\(band: string, cardId: string\): PresetRow \{/, "the reliable resolver exists beside the band resolver");
const reliableDefAt = server.indexOf("function getReliablePresetForBand(band: string, cardId: string): PresetRow {");
assert.ok(reliableDefAt >= 0, "the reliable resolver definition is found");
const reliableBodyEnd = server.indexOf("\n  }\n", reliableDefAt);
assert.ok(reliableBodyEnd > reliableDefAt, "the reliable resolver body is bounded");
const reliableBody = server.slice(reliableDefAt, reliableBodyEnd);
assert.ok(reliableBody.includes("resolveReliablePreset({"), "the resolver calls the lib cascade — a body gutted to pure band delegation fails here");
const bandDefAt = server.indexOf("function getPresetForBand(band: string, cardId: string): PresetRow {");
assert.ok(bandDefAt >= 0, "the pure band resolver still exists");
const bandBodyEnd = server.indexOf("\n  }\n", bandDefAt);
assert.ok(bandBodyEnd > bandDefAt, "the pure band resolver body is bounded");
const bandBody = server.slice(bandDefAt, bandBodyEnd);
assert.ok(!bandBody.includes("reliable"), "the pure band resolver never consults the override");
assert.match(server, /const bandPreset = getPresetForBand\(band, cardId\);/, "the draft-burst fallback still resolves the pure band preset");

// Every reliable-tier spawn resolves through the override-aware resolver:
// fresh starts, promotion handoff, research fan-out, both band swaps, and
// the initial spawn chain. A spawn that bypasses it silently ignores the
// user's override.
assert.match(server, /const effective = getReliablePresetForBand\(card\.kind === "research" \? "research" : card\.kind === "explore" \? "explore" : STAGE_TO_BAND\[card\.stage\] \?\? "analysis", cardId\);/, "fresh starts resolve reliable-aware");
assert.match(server, /const effective = getReliablePresetForBand\("research", cardId\);/, "research fan-out resolves reliable-aware");
assert.match(server, /\? getReliablePresetForBand\(STAGE_TO_BAND\[card\.stage\] \?\? "analysis", cardId\)/, "promotion handoff resolves reliable-aware");
assert.match(server, /const bandPreset = band \? getReliablePresetForBand\(band, card\.id\) : null;/, "the advance band swap resolves reliable-aware");
assert.match(server, /const bandPreset = getReliablePresetForBand\(band, cliCard\.id\);/, "the CLI advance band swap resolves reliable-aware");
assert.match(server, /const reliablePreset = reliableRow \? getPresetById\(reliableRow\.preset_id\) : null;/, "the initial spawn consults the reliable row");
assert.match(server, /const basePreset = reliablePreset \?\? bandPreset \?\? preset;/, "the initial spawn prefers reliable over band over default");

// Board and card detail show the effective preset, so the panel never
// claims the band preset while a reliable override runs the worker.
assert.match(server, /const preset = getReliablePresetForBand\(STAGE_TO_BAND\[row\.stage\] \?\? "analysis", row\.id\);/, "the board list shows the effective preset");
assert.match(server, /const preset = getReliablePresetForBand\(card\.kind === "research" \? "research" : card\.kind === "explore" \? "explore" : STAGE_TO_BAND\[card\.stage\] \?\? "analysis", card\.id\);/, "the card detail shows the effective preset");

// Manager dialog: the Reliable row is a real override select (same
// "Use band preset" empty-means-today pattern as Generation), not the
// old static "no configuration" label.
assert.doesNotMatch(app, /Band preset — no configuration/, "the unconfigurable Reliable label is gone");
assert.match(app, /rpc\.call\("assignReliablePreset", \{ presetId: value \}\)/, "the Reliable row assigns through the override RPC");
assert.match(app, /rpc\.call\("getReliablePreset", \{\}\)/, "the manager loads the current reliable override");
// Row-scoped: the empty-means-band clear option must live on the Reliable
// row itself (between its label and the Generation row) — deleting it
// strands a set override with no way back, while the RPC-string pins above
// would still pass.
const reliableRowAt = app.indexOf("✓ Reliable");
assert.ok(reliableRowAt >= 0, "the Reliable row exists");
const generationRowAt = app.indexOf("⚡ Generation", reliableRowAt);
assert.ok(generationRowAt > reliableRowAt, "the Generation row follows the Reliable row");
const reliableRow = app.slice(reliableRowAt, generationRowAt);
assert.ok(reliableRow.includes('<option value="">Use band preset</option>'), "the Reliable row offers the empty-means-band clear option");
assert.ok(reliableRow.includes("assignReliablePreset"), "the Reliable row wires its select to the override RPC");

console.log("reliable preset test ok: cascade order, singleton discipline, spawn wiring, manager override");
