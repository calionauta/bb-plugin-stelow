import assert from "node:assert/strict";
import {
  exploreCardListRequest,
  exploreCardMatches,
  explorePresetFor,
  filterAndGroupExploreCards,
  moveExploreCard,
  techniqueLabelsById,
} from "../lib/explore-panel-state.mjs";

assert.deepEqual(
  exploreCardListRequest("project_1"),
  { projectId: "project_1", kind: "explore" },
  "explore loads only the active project's exploration cards",
);

const cards = [
  { id: "card_old", projectId: "project_1", status: "inbox", needsAttention: false, updatedAt: 1 },
  { id: "card_new", projectId: "project_1", status: "in-progress", needsAttention: true, updatedAt: 2 },
  { id: "card_other", projectId: "project_2", status: "inbox", needsAttention: true, updatedAt: 3 },
];
const filters = { columns: ["inbox", "doing", "done", "archived"], projectIds: ["project_1"], attention: true };
assert.equal(exploreCardMatches(cards[0], filters), false, "attention filter excludes ordinary cards");
assert.deepEqual(filterAndGroupExploreCards(cards, filters), {
  inbox: [],
  doing: [cards[1]],
  done: [],
  archived: [],
}, "filtered groups keep the lightweight columns and newest ordering");

assert.deepEqual(
  [...techniqueLabelsById([{ id: "map", label: "Map the terrain" }])],
  [["map", "Map the terrain"]],
  "technique labels preserve the catalog ids",
);
assert.deepEqual(
  explorePresetFor(
    [{ id: "default", isDefault: true }, { id: "explore" }],
    [{ band: "explore", presetId: "explore" }],
  ),
  { preset: { id: "explore" }, hasBandPreset: true },
  "an explore assignment wins over the board default",
);
assert.deepEqual(
  explorePresetFor([{ id: "default", isDefault: true }], []),
  { preset: { id: "default", isDefault: true }, hasBandPreset: false },
  "explore falls back to the board default without an assignment",
);

let calls = 0;
await moveExploreCard(async () => {
  calls += 1;
  return { ok: true };
}, "card_new", "doing", () => {});
assert.equal(calls, 1, "a valid lightweight target is moved");
await moveExploreCard(async () => {
  calls += 1;
  return { ok: true };
}, "card_new", "triage", () => {});
assert.equal(calls, 1, "an unknown move target is refused before the RPC");

console.log("explore panel state test ok: filters, groups, labels, presets, and move targets");
