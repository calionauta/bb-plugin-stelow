import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { scopeEmptyState, scopeXrayPresentation } from "../lib/scope-xray-presentation.mjs";

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

// The card renders the projection rather than re-deriving it: a component that
// computed its own labels is how the raw enum reached the screen in the first
// place.
//
// The pin is scoped to the rendered body, because the four contract words
// legitimately appear in the View TYPE above it — narrowing to the body is what
// makes "the enum was printed again" a failure rather than a re-spelling that
// passes.
//
// It deliberately does NOT forbid reading a projected `node.state`: the
// projection's node state is the labelled `{label, tone}`, which is exactly
// what should be rendered. What is forbidden is reading the RAW view after the
// projection. Re-spelling a raw field under a new name is caught by the TYPE,
// not by a regex — `ScopeXrayPresentation` has no such field, so it does not
// compile. A regex pretending otherwise would be a copy pin that passes on
// broken logic.
const component = readFileSync(new URL("../components/detail/scope-xray.tsx", import.meta.url), "utf8");
const body = component.slice(component.indexOf("export function"));
assert.match(body, /scopeXrayPresentation\(xray\)/, "the component draws the projection, it does not derive it");
assert.doesNotMatch(body, /\bxray\./, "the raw view is never read after the projection");
for (const word of ["current", "stale", "blocked", "unknown"]) {
  const rendered = new RegExp("[{>\"'][^<]*\\b" + word + "\\b", "i");
  assert.ok(!rendered.test(body), `the raw contract word "${word}" is not rendered by the component`);
}
