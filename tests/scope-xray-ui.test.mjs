import assert from "node:assert/strict";
import test from "node:test";
import { scopeEmptyState, scopeXrayPresentation } from "../lib/scope-xray-presentation.mjs";
import { loadComponent, renderTree, treeText } from "./helpers/render-component.mjs";

/**
 * The Scope X-ray used to contradict the tracker four lines below it.
 *
 * card_cbnihg4c rendered seven approved scopes and, directly underneath,
 * "No scopes broken down yet — the agent is still shaping the card". Both were
 * true and neither was a lie on its own: the X-ray reads the approved
 * `<stateDir>/scope-map.json`, the tracker reads `stelow.json` plus the latest
 * spec, and they are written at different stages by different writers. The
 * sentence was keyed on the wrong question.
 *
 * The raw contract words made it worse. `current` is a STALENESS value
 * (lib/scope-map.mjs) meaning "this entry still matches the card's shape
 * version", printed verbatim next to a scope id, so it read as "this is the
 * scope being worked on". It was also printed in the header AND on all seven
 * nodes, from the same variable — one fact, nine times.
 */

const xray = (overrides = {}) => ({
  source: "server-projection",
  mutable: false,
  mapId: "map_1",
  mapVersion: "spec-product.md#revision-2",
  freshness: "current",
  nodes: [
    { id: "env-seed-mapper", title: "Pure mapping", capabilities: ["capability-2"], state: "current", provenance: [] },
    { id: "env-kind-control", title: "The toggle", capabilities: ["capability-1"], state: "blocked", provenance: [] },
  ],
  edges: [{ from: "env-seed-mapper", to: "env-kind-control", kind: "depends-on", state: "current", provenance: [] }],
  ...overrides,
});

test("a scope that agrees with the map says nothing of its own", () => {
  const view = scopeXrayPresentation(xray());
  assert.equal(view.nodes[0].state, null, "agreement with the map is the header's job, not seven lines'");
  assert.equal(view.nodes[0].id, "env-seed-mapper");
  assert.equal(view.nodes[0].title, "Pure mapping");
});

test("a scope that deviates is labelled in words, not with the contract enum", () => {
  const view = scopeXrayPresentation(xray());
  assert.deepEqual(view.nodes[1].state, { label: "Blocked", tone: "warn" });
  for (const node of view.nodes) {
    assert.ok(!JSON.stringify(node.state ?? {}).includes("blocked"), "the raw enum never reaches the card");
  }
});

test("freshness is said once, as a sentence a reader can act on", () => {
  const fresh = scopeXrayPresentation(xray());
  assert.equal(fresh.freshness.label, "In sync");
  assert.match(fresh.freshness.note, /still matches/i);
  assert.equal(
    fresh.nodes.filter((node) => /sync|match/i.test(node.state?.label ?? "")).length,
    0,
    "the header's fact is not repeated per node",
  );
});

test("a stale map is one header fact, not one per scope", () => {
  // The map as a whole predates the current shape, so every node is stale —
  // and saying so seven times is the nine-times problem wearing a different hat.
  const stale = scopeXrayPresentation(xray({
    freshness: "stale",
    nodes: xray().nodes.map((node) => ({ ...node, state: "stale" })),
  }));
  assert.equal(stale.freshness.label, "Out of date");
  assert.equal(stale.freshness.appliesToAll, true);
  assert.deepEqual(
    stale.nodes.map((node) => node.state),
    [null, null],
    "a map-level staleness is not a per-scope deviation",
  );
});

test("an unreadable shape version says it cannot tell, not that it is fine", () => {
  const unknown = scopeXrayPresentation(xray({ freshness: "unknown" }));
  assert.equal(unknown.freshness.label, "Freshness unknown");
  assert.match(unknown.freshness.note, /could not be read/i);
});

test("a missing X-ray is not a X-ray", () => {
  assert.equal(scopeXrayPresentation(null), null);
  assert.equal(scopeXrayPresentation(undefined), null);
});

/** The contradiction itself, stated as the test that would have caught it. */
test("an approved map with nothing tracked is not 'no scopes broken down yet'", () => {
  const copy = scopeEmptyState({
    hasMap: true,
    tracked: 0,
    cardStatus: "in-progress",
    archived: undefined,
  });
  assert.ok(copy, "a card with an approved map and no tracker still needs a sentence");
  assert.doesNotMatch(copy, /no scopes broken down/i, "the map exists; the map is not missing");
  assert.match(copy, /approved/i);
  assert.match(copy, /execution/i, "and it says when tracking actually starts");
});

test("no map and nothing tracked is the shaping sentence", () => {
  const copy = scopeEmptyState({ hasMap: false, tracked: 0, cardStatus: "in-progress", archived: undefined });
  assert.match(copy, /no scope map yet/i);
  assert.match(copy, /shaping/i);
});

test("tracked scopes need no empty sentence at all", () => {
  assert.equal(
    scopeEmptyState({ hasMap: true, tracked: 3, cardStatus: "in-progress", archived: undefined }),
    null,
    "a sentence beside a populated list is noise",
  );
});

test("a completed card with no tracking keeps its own explanation", () => {
  // Not a wedge: the pre-guard format is a real historical state, and the
  // reader is told to verify through the audit record rather than left with a
  // sentence about a map that was never written.
  const copy = scopeEmptyState({ hasMap: false, tracked: 0, cardStatus: "completed", archived: undefined });
  assert.match(copy, /completed without scoped execution/i);
  assert.match(copy, /audit record/i);
});

test("an archived card's own copy wins", () => {
  const copy = scopeEmptyState({ hasMap: true, tracked: 4, cardStatus: "archived", archived: "Archived work." });
  assert.equal(copy, "Archived work.");
});

// The card renders the projection rather than re-deriving it, so the claims
// below are asked of the RENDERED component: if it read the raw view after the
// projection, the raw contract words would reach the output and these fail.
// Only the presentational imports are stubbed; the projection is the real one.
const ScopeXray = loadComponent("components/detail/scope-xray.tsx", "ScopeXray", {
  "../../lib/scope-xray-presentation.mjs": { scopeXrayPresentation },
  "../dashboard/build-status-pills": { Pill: ({ children }) => ({ type: "span", props: {}, children: [children] }) },
  "../disclosure": { SUMMARY_BASE: "summary" },
  "../../lib/design-tokens": { TEXT_META: "text-meta", TEXT_SECTION: "text-section" },
});

/** The text a reader sees for one xray view. */
function draw(view) {
  return treeText(renderTree(ScopeXray({ xray: view })));
}

const approved = draw(xray());
const projected = scopeXrayPresentation(xray());
assert.match(approved, /env-seed-mapper/, "the node ids render");
assert.match(approved, /The toggle/, "and their titles");
assert.match(
  approved,
  new RegExp(projected.nodes[1].state.label),
  "the deviation is labelled from the projection, in words",
);
assert.equal(
  (approved.match(/In sync/g) ?? []).length,
  1,
  "freshness is said once, by the header — not repeated per scope",
);

// The stale map is the clean case for "no raw enum on the card": map-level
// staleness leaves every node silent, so any contract word in the output would
// be the component reading the raw view.
const stale = draw(xray({
  freshness: "stale",
  nodes: xray().nodes.map((node) => ({ ...node, state: "stale" })),
}));
assert.match(stale, /Out of date/, "a stale map is one header fact");
assert.doesNotMatch(stale, /Predates the current shape/, "a map-level staleness is not a per-scope deviation");
for (const word of ["current", "stale", "blocked", "unknown"]) {
  assert.ok(
    !new RegExp(`\\b${word}\\b`).test(stale),
    `the raw contract word "${word}" never reaches the card`,
  );
}

// Draft tone: the same component draws previews, but every word a draft
// renders must say draft. A "Scope map · approved" framing on a preview would
// teach the reader that drafts are decisions.
const draft = draw({ ...xray(), draft: true });
assert.match(draft, /Scope draft/, "draft heading names itself a draft");
assert.match(draft, /not approved/, "draft says it is not approved");
assert.match(draft, /Draft preview/, "draft pill names the preview");
assert.match(draft, /still has to approve/, "draft names who still has to decide");

// Decisions join the header, said once, and silence when the card holds no
// receipts — so cards without decisions draw exactly as before.
assert.match(
  draw(xray({ decisions: { live: 2, stale: 1, unknown: 0, conflicts: [{ a: "r-1", b: "r-9", scopeIds: ["s1"] }] } })),
  /2 decisions · 1 stale · contradiction: r-1 vs r-9 \(s1\)/,
  "the header carries the decisions sentence once",
);
assert.doesNotMatch(draw(xray()), /Decisions:/, "no receipts means no sentence");
