import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  splitScopeBlocks,
  countScopeDialects,
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
assert.deepEqual(countScopeDialects(null), { machine: 0, human: 0 }, "junk never throws");

// Task tables carry the acceptance criteria: only tables with both a Task
// column and a Done Criterion column qualify, and the criterion becomes
// the note the ScopesList already renders.
const humanBlocks = splitScopeBlocks(HUMAN_SPEC);
assert.deepEqual(parseScopeTasks(humanBlocks[0].body, "scope-1"), [
  { id: "scope-1-t1", name: "Split overlay root", status: "pending", source: "planned", note: "Done: Root renders alone" },
  { id: "scope-1-t2", name: "Wire trigger", status: "pending", source: "planned", note: "Done: Trigger opens overlay" },
], "task table rows become planned tasks with Done Criterion notes");
assert.deepEqual(parseScopeTasks("no tables", "scope-9"), [], "no table means no tasks");
assert.deepEqual(
  parseScopeTasks("| # | Task | Risk |\n|---|---|---|\n| 1.1 | X | LOW |\n", "scope-1"),
  [],
  "a table without a Done Criterion column is not a task table",
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
const server = readFileSync(join(root, "server.ts"), "utf8");
assert.match(server, /advanceExecutionGates\(/, "advance consults the gates module");
assert.match(server, /doneBuildGates\(/, "done consults the gates module");
assert.match(server, /diagnoseScopeSync\(\{ specContent/, "card detail reports scope-sync health from the spec against synced scopes");
assert.match(server, /scopeSync: z\.object\(\{ state: z\.enum\(/, "the card detail contract carries the sync state");
const app = readFileSync(join(root, "app.tsx"), "utf8");
assert.match(app, /isScopeTrackingMissing\(\{[^}]*scopes: detail\.scopes[^}]*\}\)/, "the checks section names missing scope tracking from live card state");
assert.match(app, /detail\?\.scopeSync && \(detail\.scopeSync\.state/, "the progress section renders the reported sync state");

console.log("scope sync guard test ok: dialects, task extraction, execution/done refusals, merge, wiring");
