import assert from "node:assert/strict";
import { cardDetailRpcContract } from "../server/card-detail-rpc-contract.ts";
import { scopeDraftSchema, scopeXraySchema } from "../server/scope-xray-contract.ts";
import { createScopeMapReader } from "../server/scope-map-reader.ts";
import { createCardDetailHandler } from "../server/runtime/card-detail.ts";
import { card, detailDeps } from "./helpers/card-detail-fixture.mjs";

// The X-ray wiring is split across the modules that own it: the RPC schema
// (card-detail-rpc-contract), the projection (scope-map-reader), and the read
// that feeds it (card-detail). Each is driven through its real export here, so
// a pin fails when the behaviour moves, not when a line of source text does.

// --- The contract exposes the shared, server-owned schemas. -----------------
const detailOutput = cardDetailRpcContract.cardDetail.output;
assert.equal(
  detailOutput.shape.scopeXray.unwrap(),
  scopeXraySchema,
  "card detail exposes the server-owned X-ray schema",
);
assert.equal(
  detailOutput.shape.scopeDraft.unwrap(),
  scopeDraftSchema,
  "card detail exposes the draft schema beside the X-ray",
);

// --- The schema enforces its own literals. ----------------------------------
const projectable = {
  source: "server-projection",
  mutable: false,
  mapId: "map-xray",
  mapVersion: "v3",
  freshness: "current",
  nodes: [],
  edges: [],
};
assert.equal(scopeXraySchema.safeParse(projectable).success, true, "a server projection validates");
assert.equal(
  scopeXraySchema.safeParse({ ...projectable, mutable: true }).success,
  false,
  "X-ray contract cannot become mutable",
);
assert.equal(
  scopeXraySchema.safeParse({ ...projectable, source: "client" }).success,
  false,
  "X-ray identifies its server projection owner",
);
assert.equal(
  scopeDraftSchema.safeParse({ ...projectable, draft: true }).success,
  true,
  "the draft marker is a literal",
);
assert.equal(
  scopeDraftSchema.safeParse({ ...projectable, draft: false }).success,
  false,
  "the draft marker is a literal, not a settable boolean",
);

// --- The reader projects the persisted map, and reads the draft's own file. --
const APPROVED_MAP = {
  schemaVersion: 1,
  mapId: "map-xray",
  status: "approved",
  shapeVersion: "v3",
  provenance: ["simulation:xray"],
  approval: { receiptId: "approval-xray", approvedBy: "simulation" },
  openDecisions: [],
  scopes: [
    {
      id: "scope-1",
      title: "Context",
      outcome: "Context",
      capabilities: ["queue"],
      inScope: ["context"],
      outOfScope: [],
      dependsOn: [],
      status: "current",
    },
    {
      id: "scope-2",
      title: "Feedback",
      outcome: "Feedback",
      capabilities: ["accessibility"],
      inScope: ["feedback"],
      outOfScope: [],
      dependsOn: ["scope-1"],
      status: "current",
    },
  ],
};
const STATE = "shape_version: v3\ncurrent_stage: interface\n";

function readerWith(files) {
  return createScopeMapReader({
    sdk: {
      files: {
        read: async ({ path }) => {
          if (!(path in files)) throw new Error(`ENOENT ${path}`);
          return { content: files[path] };
        },
      },
    },
  });
}

const reader = readerWith({
  "/s/scope-map.json": JSON.stringify(APPROVED_MAP),
  "/s/scope-map-draft.json": JSON.stringify({ ...APPROVED_MAP, status: "draft" }),
  "/s/state.md": STATE,
});
const xray = await reader.scopeXray("/s");
assert.equal(xray.source, "server-projection", "card detail builds X-ray from the persisted map");
assert.equal(xray.freshness, "current", "card detail uses card state evidence for freshness");
assert.equal(xray.nodes.length, 2, "every approved scope is drawn");
const staleReader = readerWith({
  "/s/scope-map.json": JSON.stringify(APPROVED_MAP),
  "/s/state.md": "shape_version: v4\ncurrent_stage: interface\n",
});
assert.equal((await staleReader.scopeXray("/s")).freshness, "stale", "an older Shape version reads as stale");

// A draft is drawn from its own file, and never competes with an approved map.
const noApproved = readerWith({
  "/s/scope-map-draft.json": JSON.stringify({ ...APPROVED_MAP, status: "draft" }),
  "/s/state.md": STATE,
});
assert.equal((await noApproved.scopeDraft("/s")).draft, true, "drafts read their own file, never the approved map's");
assert.equal(await reader.scopeDraft("/s"), null, "an approved map leaves no draft to preview");

// --- The detail reads both through the reader. ------------------------------
const SENTINEL_XRAY = { marker: "approved-xray" };
const SENTINEL_DRAFT = { marker: "draft-preview" };
const row = card({ kind: "build", dir_hash: "hash1" });
const handler = createCardDetailHandler(detailDeps(row, {
  cardWorkspace: async () => ({ path: "/repo", hostId: "host1" }),
  stateDir: async () => "/repo/.stelow/2026-09-24/hash1",
  scopeXray: async () => SENTINEL_XRAY,
  scopeDraft: async () => SENTINEL_DRAFT,
}));
const detail = await handler({ cardId: row.id });
assert.equal(detail.scopeXray, SENTINEL_XRAY, "card detail reads the X-ray through the scope-map reader");
assert.equal(detail.scopeDraft, SENTINEL_DRAFT, "card detail reads the draft through the scope-map reader");

console.log("scope xray wiring test ok: RPC schema, persisted-map source, read-only owner");
