// Behavior: the extracted owners answer for themselves, not by delegating to
// the composition root. Every test here fails if a seam's behavior moves back
// into plugin-runtime.ts or into a copy of the rule inside its own module.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { stripMessageDirectives } from "../server/runtime/message-text.ts";
import { parseNextStages, workflowStateDir } from "../server/runtime/workflow-state.ts";
import { boardFromRoot, findArtifacts } from "../server/runtime/board-read.ts";
import { seedWorkflow } from "../server/runtime/workflow-seeding.ts";
import { createCardLedger } from "../server/runtime/card-ledger.ts";
import { createQuestionInbox } from "../server/runtime/question-inbox.ts";
import { createClaimCoordination } from "../server/runtime/claim-coordination.ts";
import { recoveryNudge, statusLabelForSummary } from "../server/runtime/card-copy.ts";
import { auditReceiptNote } from "../server/runtime/audit-receipts.ts";
import { fileTimestamp, join as joinPath, projectRoot } from "../server/runtime/root-paths.ts";
import { runHelper } from "../server/runtime/helper-script.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = (name) => readFileSync(join(root, "server/runtime", name), "utf8");

// --- message text: renderer directives must not leak into a card comment ---
assert.equal(
  stripMessageDirectives("done ::stelow-artifact{path: audit.md} — finished"),
  "done — finished",
  "a directive becomes the space the markup occupied",
);
assert.equal(
  stripMessageDirectives("kept ::a{1} ::b{2} spaced"),
  "kept spaced",
  "each directive is stripped and the runs of spaces collapse",
);
assert.equal(stripMessageDirectives(null), "", "a missing output is empty text, not the word null");
assert.equal(
  stripMessageDirectives("plain output stays"),
  "plain output stays",
  "text without directives is untouched",
);

// --- card copy: the continue nudge a resumed worker actually receives ---
const buildNudge = recoveryNudge({ kind: "build" }, "check review_gates");
assert.match(
  buildNudge,
  /check review_gates/,
  "a Build card's nudge carries the shared interface-pick clause",
);
assert.match(
  recoveryNudge({ kind: "research" }, "check review_gates"),
  /research-index\.md/,
  "a research card is told to resume its index, not the gate table",
);
assert.match(
  recoveryNudge({ kind: "explore" }, "x"),
  /bb stelow ask/,
  "a question the worker never asked is invited rather than assumed",
);
assert.equal(statusLabelForSummary("in-progress"), "in progress");
assert.equal(statusLabelForSummary("completed"), "done");
assert.equal(statusLabelForSummary("archived"), "archived", "an unmapped status reads verbatim");

// --- claim copy: a parked scope must say what frees it ---
const claims = createClaimCoordination({
  bb: { realtime: { publish() {} } },
  db: new Database(":memory:"),
  getCard: () => undefined,
  notifyClaimWaiters: async () => {},
  now: () => 0,
});
const summary = claims.lockBlockedSummary("src/a.ts", "other card", Date.UTC(2030, 0, 2));
assert.match(summary, /src\/a\.ts/, "the blocked file is named");
assert.match(summary, /other card/, "the holder is named");
assert.match(summary, /no action needed/, "the wait promises an automatic resume");

// --- audit receipts: only the two receipts are attributed ---
assert.equal(auditReceiptNote("/w/docs/manifest.md"), null, "an unrelated file is not a receipt");
const receiptNote = auditReceiptNote("/w/.stelow/2026-01-01/x/audit.md");
assert.ok(receiptNote && receiptNote.length > 0, "the host receipt is labelled for the card");
const trailNote = auditReceiptNote("/w/.stelow/2026-01-01/x/audit-trail.md");
assert.ok(trailNote && trailNote !== receiptNote, "the portable trail is labelled apart from the host receipt");

// --- root paths: the normalizer and the tolerant readers ---
assert.equal(joinPath("/w/", "/docs/a.md"), "/w/docs/a.md", "no doubled separator");
assert.equal(fileTimestamp({ modifiedAtMs: 0 }, "unknown"), "unknown", "a zero stamp is not a date");
assert.equal(
  fileTimestamp({ modifiedAtMs: 1_700_000_000_000 }, "unknown"),
  new Date(1_700_000_000_000).toISOString(),
  "a real stamp reads as an ISO moment",
);
assert.equal(
  await projectRoot({ sdk: { projects: { get: async () => ({ sources: [{ isDefault: true, path: "/p" }] }) } } }, "p1"),
  "/p",
  "the project's default source is the workspace root",
);
assert.equal(
  await projectRoot({ sdk: { projects: { get: async () => { throw new Error("gone"); } } } }, "p1"),
  null,
  "an unreadable project is no root, never a throw",
);

// --- transitions: the installed table is the stage vocabulary ---
const transitionsFs = await import("node:fs");
const transitionsOs = await import("node:os");
const transitionsPath = await import("node:path");
const tableRoot = transitionsFs.mkdtempSync(transitionsPath.join(transitionsOs.tmpdir(), "stelow-transitions-"));
transitionsFs.mkdirSync(
  transitionsPath.join(tableRoot, "skills/stelow-workflow-orchestrator/references"),
  { recursive: true },
);
transitionsFs.writeFileSync(
  transitionsPath.join(tableRoot, "skills/stelow-workflow-orchestrator/references/transitions.md"),
  [
    "### shape",
    "next: plan, execute (whatever fits)",
    "### audit",
    "next: (none — stays at audit)",
    "rework: shape (shape rework — same stage)",
  ].join("\n"),
);
assert.deepEqual(
  parseNextStages(tableRoot, "shape"),
  ["plan", "execute"],
  "a human comment in the table is stripped, and both real targets survive",
);
assert.deepEqual(
  parseNextStages(tableRoot, "audit"),
  ["shape"],
  "the last stage block parses, and (none) contributes nothing",
);
assert.deepEqual(parseNextStages(tableRoot, "unknown"), [], "an unlisted stage offers no moves");
assert.deepEqual(parseNextStages(null, "shape"), [], "no root, no vocabulary");

// --- board reads: a workflow lists its own state and documents ---
const stateMarkdown = [
  "current_stage: execution",
  "workflow_id: card_1",
].join("\n");
const specBody = "# Spec\n\nThe product, in enough words to be evidence.\n";
/** A workspace with one workflow, one real document, and one empty file. */
const boardFiles = {
  read: async ({ path: target }) => {
    if (target.endsWith("stelow.json")) {
      return {
        content: JSON.stringify({
          workflows: [
            {
              workflowId: "card_1",
              dirHash: "sw-1",
              created: "2026-01-02T00:00:00.000Z",
              name: "Work",
              status: "in-progress",
            },
          ],
        }),
      };
    }
    if (target.endsWith("state.md")) return { content: stateMarkdown };
    if (target.endsWith("spec-product.md")) return { content: specBody };
    if (target.endsWith("notes.md")) return { content: "   \n" };
    throw new Error(`missing ${target}`);
  },
  listPaths: async ({ path: dir }) => {
    if (dir.includes("/approvals/")) return { paths: ["gate-approved.md"] };
    if (dir.endsWith("/sw-1")) {
      return {
        paths: [`${dir}/spec-product.md`, `${dir}/notes.md`, `${dir}/run.sh`],
      };
    }
    throw new Error("no such dir");
  },
};
const board = await boardFromRoot({ sdk: { files: boardFiles } }, "/w");
assert.equal(board.error, null, "a tracking file with an entry yields a board");
assert.equal(
  board.workflows[0].stage,
  "execution",
  "the stage comes from the workflow's own state.md",
);
assert.deepEqual(
  board.workflows[0].artifacts.map((entry) => entry.label),
  ["spec-product.md"],
  "a whitespace-only file is not a registered artifact, and a script is not a document",
);
assert.equal(
  board.workflows[0].artifacts[0].approved,
  true,
  "the gate receipt in the approvals dir marks the product spec approved",
);
const missing = await boardFromRoot(
  { sdk: { files: { read: async () => { throw new Error("nope"); } } } },
  "/w",
);
assert.match(
  missing.error ?? "",
  /No stelow\.json/,
  "a workspace with no tracking file names the path it looked in",
);
assert.deepEqual(
  await findArtifacts(boardFiles, "/w", {
    created: "2026-01-02T00:00:00.000Z",
    dirHash: "sw-1",
  }),
  board.workflows[0].artifacts,
  "the same reader answers for a single workflow",
);
assert.deepEqual(
  await findArtifacts(boardFiles, "/w", { created: "", dirHash: "" }),
  [],
  "a workflow with no date and hash has no directory to read, which is empty, not an error",
);
assert.deepEqual(
  await findArtifacts(
    { ...boardFiles, listPaths: async () => { throw new Error("gone"); } },
    "/w",
    { created: "2026-01-02T00:00:00.000Z", dirHash: "sw-1" },
  ),
  [],
  "an unreadable workflow directory is an empty list, never a board error",
);

// --- workflow state dir: both ownership records must agree ---
const stateDirFor = (state) => ({
  sdk: {
    files: {
      read: async ({ path }) => {
        if (path.endsWith("stelow.json")) {
          return { content: JSON.stringify({ workflows: [{ workflowId: "card_1", dirHash: "sw-1", created: "2026-01-02T00:00:00.000Z" }] }) };
        }
        return { content: state };
      },
    },
  },
});
assert.equal(
  await workflowStateDir(stateDirFor(stateMarkdown), "/w", "card_1", "sw-1"),
  "/w/.stelow/2026-01-02/sw-1",
  "an entry and a state file that agree resolve the directory",
);
assert.equal(
  await workflowStateDir(stateDirFor("workflow_id: card_other"), "/w", "card_1", "sw-1"),
  null,
  "a state file naming another owner is never adopted",
);
assert.equal(
  await workflowStateDir({ sdk: { files: { read: async () => { throw new Error("gone"); } } } }, "/w", "card_1", "sw-1"),
  null,
  "an unreadable workspace resolves no state dir rather than throwing",
);

// --- seeding: the owner identity rule, end to end on a real workspace ---
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "stelow-seed-"));
const seedFiles = {
  read: async ({ path: target }) => ({ content: fs.readFileSync(target, "utf8") }),
};
const seeded = await seedWorkflow(
  { sdk: { files: seedFiles } },
  workspace,
  "card_1",
  "My card",
  "feature",
  "Core",
  ["spec"],
);
assert.equal(seeded.error, null, "a fresh workspace seeds");
assert.ok(seeded.statePath?.endsWith("/state.md"), "the seed returns the state file it wrote");
const state = fs.readFileSync(seeded.statePath, "utf8");
assert.match(state, /workflow_id: card_1/, "the seeded state names its owner");
assert.match(state, /appetite: Core/, "the configured appetite is written");
assert.match(state, /review_gates: \[spec\]/, "the gate set is the canonical storage");
const tracking = JSON.parse(fs.readFileSync(path.join(workspace, "stelow.json"), "utf8"));
assert.equal(tracking.workflows[0].stage.current_stage, "triage", "a seeded workflow starts at triage");
// The owner advanced before anyone re-seeds it.
transitionsFs.writeFileSync(
  seeded.statePath,
  fs.readFileSync(seeded.statePath, "utf8").replace("current_stage: triage", "current_stage: audit"),
);
const reseeded = await seedWorkflow(
  { sdk: { files: seedFiles } },
  workspace,
  "card_1",
  "Renamed card",
  "feature",
);
assert.equal(reseeded.statePath, seeded.statePath, "re-seeding an owner returns its own directory");
assert.match(
  fs.readFileSync(seeded.statePath, "utf8"),
  /current_stage: audit/,
  "re-seeding a live owner is a no-op: its progress is never reset to triage",
);
const afterReseed = JSON.parse(
  fs.readFileSync(path.join(workspace, "stelow.json"), "utf8"),
).workflows[0];
assert.equal(
  afterReseed.name,
  "My card",
  "re-seeding a live owner rewrites nothing: not even the name it was given",
);
assert.equal(
  afterReseed.stage.current_stage,
  "triage",
  "a re-seed never resets the tracking entry back to the start",
);
fs.rmSync(workspace, { recursive: true, force: true });

// --- the ledger and the question inbox read the database they were given ---
const db = new Database(":memory:");
db.exec(
  "CREATE TABLE card_stage_events (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT, stage TEXT, entered_at INTEGER);"
    + " CREATE TABLE comments (id TEXT PRIMARY KEY, card_id TEXT, target TEXT, target_id TEXT, author TEXT, body TEXT, created_at INTEGER);"
    + " CREATE TABLE cards (id TEXT PRIMARY KEY, worker_thread_id TEXT);"
    + " CREATE TABLE expired_questions (id TEXT PRIMARY KEY, card_id TEXT, answered INTEGER, expired_at INTEGER);"
    + " CREATE TABLE verification_runs (card_id TEXT, head_sha TEXT, created_at INTEGER);",
);
const ledger = createCardLedger({ db, now: () => 1000 });
ledger.recordStageEvent("card_1", "shape");
ledger.recordStageEvent("card_1", "done");
assert.deepEqual(
  ledger.stageEvents("card_1").map((event) => event.stage),
  ["shape", "done"],
  "stage entries are read back in order",
);
const open = ledger.flowTimesForCard({ id: "card_1", created_at: 900 });
assert.equal(open.doneAt, 1000, "the done entry ends both clocks");
assert.equal(ledger.flowTimesForCard({ id: "card_missing", created_at: 900 }).doneAt, null, "an unfinished card has no lead time");
db.prepare("INSERT INTO verification_runs (card_id, head_sha, created_at) VALUES (?, ?, ?)").run("card_1", "abc123", 1);
assert.equal(ledger.verifiedHeadShaForCard("card_1"), "abc123", "a done card names the tree it was verified at");
assert.ok(ledger.logCardComment("card_1", "card", "card_1", "agent", "trail"), "a comment id comes back for callers that reference it");
assert.equal(
  db.prepare("SELECT body FROM comments WHERE card_id = ?").get("card_1").body,
  "trail",
  "the trail row is written once, through the single writer",
);
db.prepare("INSERT INTO cards (id, worker_thread_id) VALUES (?, ?)").run("card_1", "thr_1");
assert.equal(ledger.getCardByWorkerThread("thr_1").id, "card_1", "the thread answers which card it was");
assert.equal(ledger.getCardByWorkerThread("thr_other"), undefined, "an unknown thread names no card");

const synced = [];
const questions = createQuestionInbox({
  db,
  bb: { sdk: { threads: { interactions: { list: async () => [] } } } },
  syncPendingQuestionInbox: (card, ids) => synced.push([card.id, ids]),
});
db.prepare("INSERT INTO expired_questions (id, card_id, answered, expired_at) VALUES (?, ?, 0, 1)").run("q1", "card_1");
assert.deepEqual(questions.openExpiredQuestionIds("card_1"), ["expired:q1"], "an expired question stays open until answered");
assert.deepEqual(
  await questions.syncOpenQuestionInbox({ id: "card_1", worker_thread_id: null }),
  ["expired:q1"],
  "a workerless card still reports its expired questions",
);
assert.deepEqual(synced[0], ["card_1", ["expired:q1"]], "the inbox is synced to exactly the open set");
assert.equal(questions.hasOpenQuestions("card_1", []), false, "an empty known set means no open question");
assert.equal(questions.hasOpenQuestions("card_1", null), true, "an unknown set defers to the recoverable store");
db.close();

// --- the helper runner reports, it never throws on a failed spawn ---
const refused = await runHelper(["advance", "nope"], "/nonexistent-stelow-workspace");
assert.notEqual(refused.code, 0, "a helper that cannot run reports a non-zero code");
assert.ok(typeof refused.stderr === "string", "the caller always gets a stream pair to show");

// --- topology: the root wires the owners, it does not re-implement them ---
const core = runtime("runtime-core.ts");
const reads = runtime("read-runtime.ts");
for (const [name, source] of [["runtime-core", core], ["read-runtime", reads]]) {
  assert.match(source, /createRuntimeCore|createReadRuntime/, `${name} is the assembly step`);
}
const pluginSource = readFileSync(join(root, "server/plugin-runtime.ts"), "utf8");
assert.doesNotMatch(
  pluginSource,
  /async function (cardCheckout|cardStageSlug|seedWorkflow|runGitIn|logCardComment)\b/,
  "a seam that has an owner must not also be defined in the composition root",
);
assert.match(
  pluginSource,
  /const core = createRuntimeCore\(bb\);/,
  "the root wires the assembled core by name",
);

console.log(
  "runtime seam behavior ok: copy, claims, paths, board, state dir, seeding, ledger, questions, helper",
);
