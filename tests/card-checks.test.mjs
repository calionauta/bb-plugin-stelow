import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { groupCardChecks, groupState, isExecutionUntracked } from "../lib/card-checks.mjs";

const scopes = [
  { id: "s1", name: "Checkout", status: "done", tasks: [{ name: "t1", status: "done" }] },
  { id: "s2", name: "Apple Pay", status: "in-progress", tasks: [{ name: "t2", status: "in-progress" }, { name: "t3", status: "pending" }] },
];
const questions = [{ title: "Ship it?", question: "Ship it?" }];
const gaps = { matched: true, items: [{ description: "Missing test" }], fixed: 2, documented: 1, total: 4 };

// Groups read by type with done/pending counts, from the same sources the
// heroes read — scopes, tasks, questions, gaps, review. Nothing invented.
const groups = groupCardChecks({ questions, scopes, gaps, review: { pending: false, done: false } });
assert.deepEqual(groups.map((group) => group.id), ["scopes", "tasks", "questions", "gaps"], "types group in stable order");
const byId = new Map(groups.map((group) => [group.id, group]));
assert.deepEqual(byId.get("scopes"), { id: "scopes", label: "Scopes", open: ["Apple Pay"], doneCount: 1, total: 2 }, "scopes split open from done");
assert.deepEqual(byId.get("tasks"), { id: "tasks", label: "Tasks", open: ["t2", "t3"], doneCount: 1, total: 3 }, "tasks split across scopes");
assert.deepEqual(byId.get("questions"), { id: "questions", label: "Questions", open: ["Ship it?"], doneCount: 0, total: 1 }, "questions list titles");
assert.deepEqual(byId.get("gaps"), { id: "gaps", label: "Gaps", open: ["Missing test"], doneCount: 3, total: 4 }, "gaps count fixed+documented as done");

// Groups with no applicable items resolve absent, never empty: review on
// a card going nowhere is noise, and unmatched gaps stay invisible.
assert.deepEqual(groupCardChecks({ questions: [], scopes: [], gaps: null, review: null }), [], "nothing applicable resolves to no groups");
assert.deepEqual(
  groupCardChecks({ questions: [], scopes: [], gaps: null, review: { pending: true, done: false } }).map((group) => group.id),
  ["review"],
  "review resolves alone when it is the only pending thing",
);
assert.deepEqual(
  groupCardChecks({ questions: [], scopes: [], gaps: { matched: false, items: [], fixed: 0, documented: 0, total: 0 }, review: null }),
  [],
  "unmatched gaps stay invisible",
);

// State is done only with items and none open; the filter reads it.
assert.equal(groupState({ open: [], doneCount: 2, total: 2 }), "done", "all closed reads done");
assert.equal(groupState({ open: ["x"], doneCount: 1, total: 2 }), "pending", "any open reads pending");
assert.equal(groupState(null), "empty", "junk reads empty");
assert.equal(groupState({}), "empty", "shapeless reads empty");

// The extracted detail section keeps one gap request and one checks rollup:
// same live sources (pending + expired questions, scope states, the shared gap
// summary, review flag), with pending-only on by default. These wiring pins
// constrain topology only; grouping and guard behavior are asserted above.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const progress = readFileSync(join(root, "components/detail/build-progress.tsx"), "utf8");
assert.match(app, /<BuildProgress[\s\S]*card=\{card\}[\s\S]*detail=\{detail\}/, "detail renders the extracted progress section with card and detail in scope");
assert.equal((progress.match(/rpc\.call\("gapSummary", \{ cardId \}\)/g) ?? []).length, 1, "checks and gaps share one gapSummary request");
assert.match(progress, /questions: \[\.\.\.detail\.pendingQuestions, \.\.\.detail\.expiredQuestions\]/, "questions cover live and expired asks");
assert.match(progress, /review: card\.status === "completed" \? \{ pending: card\.hasPendingReview/, "review resolves from card state, never inferred");
assert.match(progress, /const \[pendingOnly, setPendingOnly\] = useState\(true\)/, "the pending filter defaults on");
assert.match(progress, /isExecutionUntracked\(\{ activity: card\.activity, scopes: detail\.scopes \}\)/, "the rollup names untracked execution from live card state");
assert.match(progress, /isScopeTrackingMissing\(\{[^}]*scopes: detail\.scopes[^}]*\}\)/, "the rollup names missing scope tracking from live card state");

// Untracked execution: running with synced scopes but nothing ever marked
// (neither in-progress nor done) names the silence bands — the exact shape
// of a done-with-pending-scopes surprise, caught while there is still time.
assert.equal(isExecutionUntracked({ activity: "running", scopes: [{ status: "pending" }, { status: "pending" }] }), true, "running with all scopes pending warns");
assert.equal(isExecutionUntracked({ activity: "running", scopes: [{ status: "done" }] }), false, "a finished scope is marking enough");
assert.equal(isExecutionUntracked({ activity: "running", scopes: [{ status: "in-progress" }] }), false, "an in-progress scope is marking");
assert.equal(isExecutionUntracked({ activity: "running", scopes: [{ status: "skipped" }] }), true, "all-skipped while running still warns — skipping everything is the same silence");
assert.equal(isExecutionUntracked({ activity: "idle", scopes }), false, "idle workers are paused, not untracked");
assert.equal(isExecutionUntracked({ activity: "running", scopes: [] }), false, "no scopes means nothing to track");
assert.equal(isExecutionUntracked({ activity: "running", scopes: null }), false, "junk never warns");

console.log("card checks test ok: grouped types, done/pending states, absent empties");
