import assert from "node:assert/strict";
import { createScopeMapReader } from "../server/scope-map-reader.ts";

// The reader attaches the header-level decisions line best-effort: receipts
// present means a summary, absent means the X-ray draws exactly as before,
// and an unreadable store never breaks the map.
const map = {
  schemaVersion: 1,
  mapId: "map_1",
  status: "approved",
  shapeVersion: "v7",
  provenance: ["simulation:decisions"],
  approval: { receiptId: "r", approvedBy: "operator" },
  openDecisions: [],
  scopes: [
    { id: "s1", title: "One", outcome: "o", capabilities: ["cap-a"], inScope: ["a"], outOfScope: [], dependsOn: [], status: "current" },
  ],
};

const receipt = {
  schemaVersion: 1,
  id: "dec-1",
  kind: "selection",
  selectedId: "opt-5",
  rejectedOptionIds: ["opt-3"],
  scopeIds: ["s1"],
  authorizesVersions: { shape_version: "v7" },
  supersedes: [],
  supersededBy: null,
  challengeId: null,
  reason: null,
  approvedBy: "operator",
  approvedAt: "2026-10-08T00:00:00.000Z",
};

function reader(files) {
  return createScopeMapReader({ sdk: { files } });
}

function filesFor(store) {
  return {
    read: async ({ path }) => {
      if (path.endsWith("scope-map.json")) return { content: JSON.stringify(map) };
      if (path.endsWith("state.md")) return { content: "---\nshape_version: v7\n---\n" };
      if (path.endsWith("decision-receipts.json")) {
        if (store === null) throw new Error("missing");
        return { content: store };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

const withReceipts = reader(filesFor(JSON.stringify({ version: 1, receipts: [receipt], challenges: [] })));
const xray = await withReceipts.scopeXray("/state");
assert.ok(xray, "approved map still draws");
assert.deepEqual(xray.decisions, { live: 1, stale: 0, unknown: 0, conflicts: [] });

const without = reader(filesFor(null));
const bare = await without.scopeXray("/state");
assert.ok(bare, "approved map still draws");
assert.ok(!("decisions" in bare) || bare.decisions == null, "no receipts means no sentence");

const corrupt = reader(filesFor("{oops"));
const drawn = await corrupt.scopeXray("/state");
assert.ok(drawn, "an unreadable store never breaks the map");

console.log("decision-xray-reader: ok");
