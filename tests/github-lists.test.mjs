import assert from "node:assert/strict";
import { filterImportCandidates, preselectFreshIssues, sortedUnion } from "../lib/github-lists.mjs";

// Union + alphabetical, duplicates collapsed.
assert.deepEqual(sortedUnion([["bob", "alice"], ["alice", "carol"]]), ["alice", "bob", "carol"]);
// Fail-soft: non-arrays ignored, non-strings dropped, blanks trimmed out.
assert.deepEqual(sortedUnion([null, "junk", [" ok ", "", 42, null, "ok"]]), ["ok"]);
// Single non-array input degrades to empty, never throws.
assert.deepEqual(sortedUnion(null), []);
assert.deepEqual(sortedUnion("bob"), []);

// Narrowing: open picks pass everything, assignee/project picks filter.
const candidates = [
  { repo: "a/x", number: 1, assignees: ["octocat"], projectId: "p1" },
  { repo: "a/x", number: 2, assignees: [], projectId: null },
  { repo: "b/y", number: 3 },
];
assert.deepEqual(filterImportCandidates(candidates, {}), candidates, "open filters pass everything");
assert.deepEqual(filterImportCandidates(candidates, { assignee: "octocat" }).map((issue) => issue.number), [1], "assignee narrows");
assert.deepEqual(filterImportCandidates(candidates, { assignee: "nobody" }), [], "unknown assignee matches nothing");
assert.deepEqual(filterImportCandidates(candidates, { project: "p1" }).map((issue) => issue.number), [1], "project narrows");
assert.deepEqual(filterImportCandidates(candidates, { project: "unmapped" }).map((issue) => issue.number), [2, 3], "projectless repos isolate as unmapped");
assert.deepEqual(filterImportCandidates(null, {}), [], "junk narrows to nothing, never throws");
assert.deepEqual(filterImportCandidates("junk", { assignee: "octocat" }), [], "non-array narrows to nothing");

// Preselect: only not-yet-imported issues come checked.
assert.deepEqual(
  preselectFreshIssues([
    { repo: "a/x", number: 1, alreadyImported: false },
    { repo: "a/x", number: 2, alreadyImported: true },
  ]),
  { "a/x#1": true },
  "fresh issues preselect, imported ones stay unchecked",
);
assert.deepEqual(preselectFreshIssues([]), {}, "nothing listed preselects nothing");
assert.deepEqual(preselectFreshIssues(null), {}, "junk preselects nothing, never throws");

console.log("github lists test ok: sorted union, candidate narrowing, fresh preselect, fail-soft inputs");
