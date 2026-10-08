import assert from "node:assert/strict";
import { formatDecisionNote, summarizeDecisions } from "../lib/decision-xray.mjs";

const v7 = { shapeVersion: "v7" };
const live = { id: "r-1", scopeIds: ["s1"], selectedId: "opt-5", authorizesVersions: { shape_version: "v7" } };
const stale = { id: "r-2", scopeIds: ["s2"], selectedId: "opt-1", authorizesVersions: { shape_version: "v6" } };
const versionless = { id: "r-3", scopeIds: ["s3"], selectedId: "opt-9" };

// Counts split live/stale/unknown; no receipts means no summary.
const summary = summarizeDecisions([live, stale, versionless], v7);
assert.deepEqual(summary, { live: 3, stale: 1, unknown: 1, conflicts: [] });
assert.equal(summarizeDecisions([], v7), null);
assert.equal(summarizeDecisions(null, v7), null);

// Contradicting live receipts surface with their scopes.
const clash = summarizeDecisions(
  [live, { id: "r-9", scopeIds: ["s1"], selectedId: "opt-3", authorizesVersions: { shape_version: "v7" } }],
  v7,
);
assert.equal(clash.conflicts.length, 1);
assert.deepEqual(clash.conflicts[0], { a: "r-1", b: "r-9", scopeIds: ["s1"] });

// One sentence, said once; silence when there is nothing to say.
assert.equal(formatDecisionNote(summary), "3 decisions · 1 stale · 1 of unknown freshness");
assert.equal(
  formatDecisionNote(clash),
  "2 decisions · contradiction: r-1 vs r-9 (s1)",
);
assert.equal(formatDecisionNote(null), "");
assert.equal(formatDecisionNote({ live: 0, stale: 0, unknown: 0, conflicts: [] }), "");

console.log("decision-xray: ok");
