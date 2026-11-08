import assert from "node:assert/strict";
import {
  resolveReliablePreset,
  RELIABLE_SOURCE_CARD,
  RELIABLE_SOURCE_OVERRIDE,
  RELIABLE_SOURCE_BAND,
  RELIABLE_SOURCE_DEFAULT,
} from "../lib/reliable-preset.mjs";

// Reliable-tier override: an optional board-level preset that replaces the
// band preset for reliable spawns. Empty means today's behavior — the test
// that would catch a regression that silently re-routes workers (e.g. a
// cascade reorder that lets the band preset beat an explicit pin, or a
// spawn site that bypasses the resolver).

// Cascade order: card pin > reliable override > band > default. A reorder
// here changes which brain runs the worker, so each level is pinned.
assert.deepEqual(
  resolveReliablePreset({
    cardPin: "c",
    reliableOverride: "r",
    bandPreset: "b",
    defaultPreset: "d",
  }),
  { presetId: "c", source: RELIABLE_SOURCE_CARD },
  "the per-card pin beats everything",
);
assert.deepEqual(
  resolveReliablePreset({
    cardPin: null,
    reliableOverride: "r",
    bandPreset: "b",
    defaultPreset: "d",
  }),
  { presetId: "r", source: RELIABLE_SOURCE_OVERRIDE },
  "the reliable override replaces the band preset when set",
);
assert.deepEqual(
  resolveReliablePreset({
    cardPin: null,
    reliableOverride: null,
    bandPreset: "b",
    defaultPreset: "d",
  }),
  { presetId: "b", source: RELIABLE_SOURCE_BAND },
  "empty override falls back to the band preset (today's behavior)",
);
assert.deepEqual(
  resolveReliablePreset({
    cardPin: null,
    reliableOverride: null,
    bandPreset: null,
    defaultPreset: "d",
  }),
  { presetId: "d", source: RELIABLE_SOURCE_DEFAULT },
  "no band preset falls back to the card/board default",
);
assert.deepEqual(
  resolveReliablePreset({
    cardPin: "",
    reliableOverride: "",
    bandPreset: "",
    defaultPreset: "",
  }),
  { presetId: null, source: null },
  "empty strings resolve to nothing, never to a refusal downstream",
);

console.log(
  "reliable preset test ok: cascade order, singleton discipline, spawn wiring, manager override",
);
