import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { groupCardChecks, groupState } from "../lib/card-checks.mjs";

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

// The detail renders one rollup above the scopes: same sources the heroes
// read (pending + expired questions, scope states, gap summary, review
// flag), grouped by type with a pending-only filter defaulting on. A
// rollup that invented its own sources would drift — this one cannot.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
assert.match(app, /<CardChecksSection cardId=\{card\.id\} card=\{card\} detail=\{detail\} \/>/, "detail renders the rollup with card and detail in scope");
assert.match(app, /questions: \[\.\.\.detail\.pendingQuestions, \.\.\.detail\.expiredQuestions\]/, "questions cover live and expired asks");
assert.match(app, /rpc\.call\("gapSummary", \{ cardId \}\)/, "gaps resolve through the same RPC as the gaps section");
assert.match(app, /review: card\.status === "completed" \? \{ pending: card\.hasPendingReview/, "review resolves from card state, never inferred");
assert.match(app, /const \[pendingOnly, setPendingOnly\] = useState\(true\)/, "the pending filter defaults on");

console.log("card checks test ok: grouped types, done/pending states, absent empties");
