import assert from "node:assert/strict";
import { createScopeMapReader } from "../server/scope-map-reader.ts";

// Behavior, not wiring: the draft preview exists only while no approved map
// does. A draft beside an approved map stays hidden (it has nothing to add),
// an off-contract draft is refused (not drawn broken), and anything missing
// reads as absent. The wiring pins prove the code paths exist; these prove
// what they decide.
const STATE = "state.md content\nshape_version: v1\n";

function makeDraft(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    mapId: "map-draft",
    status: "draft",
    shapeVersion: "v1",
    provenance: ["simulation:draft"],
    openDecisions: [],
    scopes: [
      {
        id: "scope-1",
        title: "First slice",
        outcome: "First slice",
        capabilities: ["one"],
        inScope: ["a"],
        outOfScope: [],
        dependsOn: [],
        status: "current",
      },
    ],
    ...overrides,
  });
}

function makeApproved() {
  const map = JSON.parse(makeDraft());
  map.status = "approved";
  map.approval = { receiptId: "r1", approvedBy: "simulation" };
  return JSON.stringify(map);
}

function readerFor(files) {
  const bb = {
    sdk: {
      files: {
        read: async ({ path }) => {
          if (!(path in files)) throw new Error("missing");
          return { content: files[path] };
        },
      },
    },
  };
  return createScopeMapReader(bb);
}

const DIR = "/state";

{
  const reader = readerFor({ [`${DIR}/scope-map-draft.json`]: makeDraft(), [`${DIR}/state.md`]: STATE });
  const draft = await reader.scopeDraft(DIR);
  assert.ok(draft, "a lone draft previews");
  assert.equal(draft.draft, true, "the preview carries the draft marker");
  assert.equal(draft.nodes.length, 1, "the preview projects every draft scope");
  assert.equal(await reader.scopeXray(DIR), null, "no approved map means no X-ray");
}

{
  const reader = readerFor({
    [`${DIR}/scope-map.json`]: makeApproved(),
    [`${DIR}/scope-map-draft.json`]: makeDraft(),
    [`${DIR}/state.md`]: STATE,
  });
  assert.equal(await reader.scopeDraft(DIR), null, "a draft never competes with an approved map");
  assert.ok(await reader.scopeXray(DIR), "the approved map still draws");
}

{
  const reader = readerFor({ [`${DIR}/scope-map-draft.json`]: "{not json", [`${DIR}/state.md`]: STATE });
  assert.equal(await reader.scopeDraft(DIR), null, "an unparseable draft is refused, not drawn broken");
}

{
  const reader = readerFor({ [`${DIR}/scope-map-draft.json`]: makeDraft({ scopes: [] }), [`${DIR}/state.md`]: STATE });
  assert.equal(await reader.scopeDraft(DIR), null, "an off-contract draft is refused, not drawn broken");
}

{
  const reader = readerFor({});
  assert.equal(await reader.scopeDraft(null), null, "no state dir reads as absent");
  assert.equal(await reader.scopeDraft(DIR), null, "missing files read as absent");
}

{
  // An approved-status file at the draft path is not a draft: it draws as
  // nothing (and would draw as the map only through the approved reader).
  const reader = readerFor({ [`${DIR}/scope-map-draft.json`]: makeApproved(), [`${DIR}/state.md`]: STATE });
  assert.equal(await reader.scopeDraft(DIR), null, "approved content at the draft path is not a preview");
}

console.log("scope draft test ok: preview-only, hidden beside approved, refused when off-contract");
