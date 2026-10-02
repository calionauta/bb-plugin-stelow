import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  splitScopeBlocks,
  countScopeDialects,
  humanScopeLines,
  parseScopeTasks,
  diagnoseScopeSync,
  mergePlannedTasks,
} from "../lib/spec-scope-reader.mjs";

// Fixture mirroring the card_pttx9ion incident: the tech-planning output
// template invites human headings (`### SCOPE-1: Title`), which the
// canonical sync-scopes parser silently skips (warn + exit 0) — so the
// card reached audit with 0 synced scopes and an empty visual.
const HUMAN_SPEC = `# Tech plan

## 1. Identified Scopes

### SCOPE-1: Overlay split
- **Type:** \`feature\`
- **Dependencies:** none

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 1.1 | Split overlay root | ui-overlay | LOW (2) | Root renders alone | P2: Key enabler |
| 1.2 | Wire trigger | ui-trigger | HIGH (4) | Trigger opens overlay | P3: Risk score 4 |

### SCOPE-2: Drawer fallback
- **Type:** \`feature\`
- **Dependencies:** SCOPE-1

| # | Task | Components | Risk | Done Criterion | Order Rationale |
|---|------|-----------|------|---------------|-----------------|
| 2.1 | Fallback shell | ui-drawer | LOW (1) | Shell renders | P5: Nice-to-have |
`;

const MACHINE_SPEC = `[SCOPE-1] Overlay split
[TYPE] feature
[TARGET_FILES]
- components/ui/overlay.tsx
Dependencies: none

[SCOPE-2] Drawer fallback
[TYPE] feature
Dependencies: SCOPE-1
`;

// The reader sees both dialects: machine blocks the writer understands,
// human headings it silently skips.
assert.deepEqual(
  splitScopeBlocks(HUMAN_SPEC).map((block) => ({ n: block.n, title: block.title, dialect: block.dialect })),
  [
    { n: "1", title: "Overlay split", dialect: "human" },
    { n: "2", title: "Drawer fallback", dialect: "human" },
  ],
  "human headings split into per-scope blocks",
);
assert.deepEqual(
  splitScopeBlocks(MACHINE_SPEC).map((block) => ({ n: block.n, dialect: block.dialect })),
  [{ n: "1", dialect: "machine" }, { n: "2", dialect: "machine" }],
  "machine blocks keep parsing",
);
assert.deepEqual(countScopeDialects(HUMAN_SPEC), { machine: 0, human: 2 }, "human spec counts as human");
assert.deepEqual(countScopeDialects(MACHINE_SPEC), { machine: 2, human: 0 }, "machine spec counts as machine");
assert.deepEqual(countScopeDialects("no scopes here"), { machine: 0, human: 0 }, "junk counts zero");
assert.deepEqual(humanScopeLines(HUMAN_SPEC), [5, 14], "human lines locate openers for the fix");
assert.deepEqual(humanScopeLines("no scopes"), [], "no headings means no lines");
assert.deepEqual(humanScopeLines(null), [], "junk means no lines");
assert.deepEqual(countScopeDialects(null), { machine: 0, human: 0 }, "junk never throws");

// Task tables carry the acceptance criteria: only tables with both a Task
// column and a Done Criterion column qualify, and the criterion becomes
// the note the ScopesList already renders.
const humanBlocks = splitScopeBlocks(HUMAN_SPEC);
assert.deepEqual(parseScopeTasks(humanBlocks[0].body, "scope-1"), [
  { id: "1.1", name: "Split overlay root", kind: "task", status: "pending", source: "planned", note: "Done: Root renders alone" },
  { id: "1.2", name: "Wire trigger", kind: "task", status: "pending", source: "planned", note: "Done: Trigger opens overlay" },
], "task table rows become planned tasks with Done Criterion notes, keyed by the id the table DECLARES");
assert.deepEqual(parseScopeTasks("no tables", "scope-9"), [], "no table means no tasks");
assert.deepEqual(
  parseScopeTasks("| # | Task | Risk |\n|---|---|---|\n| 1.1 | X | LOW |\n", "scope-1"),
  [],
  "a table without a Done Criterion column is not a task table",
);
assert.deepEqual(
  parseScopeTasks("| Task | Done Criterion |\n|---|---|\n| Only a name | shipped |\n", "scope-7"),
  [{ id: "scope-7-t1", name: "Only a name", kind: "task", status: "pending", source: "planned", note: "Done: shipped" }],
  "a table with no id column falls back to scope-N-tM, so a spec without one still parses",
);

// Diagnosis names the incident shape instead of collapsing to "no scopes".
assert.deepEqual(diagnoseScopeSync({ specContent: HUMAN_SPEC, syncedCount: 0 }).state, "human-dialect", "human spec with 0 synced scopes names the dialect");
assert.deepEqual(diagnoseScopeSync({ specContent: MACHINE_SPEC, syncedCount: 0 }).state, "unsynced", "machine spec with 0 synced scopes names the missed sync");
assert.deepEqual(diagnoseScopeSync({ specContent: MACHINE_SPEC, syncedCount: 2 }).state, "ok", "synced scopes read ok");
assert.deepEqual(diagnoseScopeSync({ specContent: null, syncedCount: 0 }).state, "no-spec", "missing spec reads missing, never broken");

// Entry/done refusals live in lib/build-gates.mjs (order-tested there);
// this file pins the reader behavior they build on.

// Planned tasks enrich synced scopes only: tracked tasks win on conflict,
// blocks without a synced scope invent nothing.
const tracked = [{ id: "scope-1", name: "Overlay split", status: "pending", tasks: [{ id: "scope-1-t1", name: "Split overlay root", status: "done" }] }];
const merged = mergePlannedTasks(tracked, HUMAN_SPEC);
assert.equal(merged[0].tasks.length, 2, "planned task joins the synced scope");
assert.equal(merged[0].tasks[0].status, "done", "tracked status wins on id conflict");
assert.deepEqual(mergePlannedTasks([], HUMAN_SPEC), [], "no synced scope means nothing invented");
assert.deepEqual(mergePlannedTasks(tracked, null), tracked, "missing spec returns tracking untouched");

// Upstream scope-start seed writes planned tasks with table ids (`3.1`)
// while this reader generates `scope-N-tM`: the union key is id OR
// normalized name, so the same task never renders twice.
const seeded = [{ id: "scope-1", name: "Overlay split", status: "in-progress", tasks: [
  { id: "1.1", name: "Split overlay root", status: "done", source: "planned" },
  { id: "scope-9-t9", name: "Unrelated", status: "pending", source: "discovered" },
] }];
const reseeded = mergePlannedTasks(seeded, HUMAN_SPEC);
assert.equal(reseeded[0].tasks.length, 3, "same-name planned task dedupes across id schemes, the rest unions");
assert.equal(reseeded[0].tasks[0].status, "done", "seeded status survives the merge");

// Wiring pins (topology, not copy): the advance-into-execution path and the
// done path must consult the guard, and the checks section must name the
// missing-tracking signal.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/card-detail.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/card-detail-presentation.ts"), "utf8"),
  readFileSync(join(root, "server/card-detail-rpc-contract.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli/cli-done-build.ts"), "utf8"),
].join("\n");
const executionAdvance = readFileSync(join(root, "server/execution-advance-preflight.ts"), "utf8");
assert.match(executionAdvance, /advanceExecutionGates\(/, "advance consults the gates module");
assert.match(server, /doneBuildGates\(/, "done consults the gates module");
assert.match(
  server,
  /diagnoseScopeSync\(\{\s*specContent:/,
  "card detail reports scope-sync health from the spec against synced scopes",
);
assert.match(server, /scopeSync: z\s*\.object\(\{\s*state: z\.enum\(/, "the card detail contract carries the sync state");
const buildProgress = readFileSync(join(root, "components/detail/build-progress.tsx"), "utf8");
// The panel reads the server's classification and nothing else. The stage-derived
// rule it replaced fired on cards that never planned — the reported state is
// `no-spec` on those, and a notice that invents a spec the reader never owed is
// worse than silence.
assert.doesNotMatch(buildProgress, /isScopeTrackingMissing/, "the stage-derived scope-tracking rule is not used");
assert.match(buildProgress, /scopeSyncNotice\(detail\.scopeSync,/, "the notice is decided once, in lib, from the reported state");
assert.doesNotMatch(buildProgress, /No synced scopes on this card/, "the copy that accused a reader of a nonexistent spec is gone");
assert.doesNotMatch(buildProgress, /!detail\.scopeSync \|\| !\["human-dialect", "unsynced"\]/, "the alarm list is not re-spelled in the view");

console.log("scope sync guard test ok: dialects, task extraction, execution/done refusals, merge, wiring");

// The duplication that reached a live card, and the reason the reader changed.
//
// A worker seeded tasks with the id the spec declared (`1.1`) but with its own
// reworded text ("Extract the stage projection into lib as an .mjs pair" where
// the spec said "Extract the per-surface stage projection into lib/ as a .mjs +
// .d.mts pair with a node test"). Neither the id key nor the name key matched,
// so mergePlannedTasks appended all four spec rows a second time as pending:
// 4 tracked + 4 phantom = 8 tasks for 4 pieces of work.
//
// The card then read "12/12 scopes complete" beside "33/52 tasks". Both numbers
// were true of different stores — scope status came from tracking, the task
// count came from the projection — and nothing on the card said so. Four
// verify/audit passes and every gate in the repo reported green; only a person
// reading the card caught it, because the only symptom was a total that
// disagreed with its own scope count.
//
// So the reader now honours the declared id column. The name key stays as the
// fallback for specs that predate it, but it is no longer load-bearing.
const reworded = [{ id: "scope-1", name: "Stage vocabulary", status: "done", tasks: [
  { id: "1.1", name: "Extract the stage projection into lib as an .mjs pair", status: "done", source: "planned" },
  { id: "1.2", name: "Point workflow-map and the chip at the projection", status: "done", source: "planned" },
  { id: "1.3", name: "Point the advance dialog at the same projection", status: "done", source: "planned" },
  { id: "1.4", name: "Anti-regression test on the catalog readers", status: "done", source: "planned" },
] }];
const afterReword = mergePlannedTasks(reworded, HUMAN_SPEC);
assert.equal(
  afterReword[0].tasks.length,
  4,
  "a worker that reworded its task text still matches on the DECLARED id — the four spec rows "
  + "must not reappear as pending phantoms beside four real ones",
);
assert.ok(
  afterReword[0].tasks.every((task) => task.status === "done"),
  "and none of them is a pending duplicate",
);

// The id column is read when present, and the fallback still holds without it.
const idColumn = parseScopeTasks(
  "| # | Task | Done Criterion |\n|---|---|---|\n| 2.1 | Declared id | shipped |\n| 2.2 | Also declared | shipped |\n",
  "scope-2",
);
assert.deepEqual(idColumn.map((task) => task.id), ["2.1", "2.2"], "the declared # column is the task id");

// And a spec whose rows carry ids that match tracking exactly unions to nothing.
const exact = [{ id: "scope-1", name: "Overlay split", status: "done", tasks: [
  { id: "1.1", name: "anything at all", status: "done", source: "planned" },
  { id: "1.2", name: "anything either", status: "done", source: "planned" },
] }];
assert.equal(
  mergePlannedTasks(exact, HUMAN_SPEC)[0].tasks.length,
  2,
  "matching ids dedupe even when every word of the name differs — the id is the contract",
);
