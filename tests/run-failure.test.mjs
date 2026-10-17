import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lastRunFailure,
  runFailure,
  runFailureDetail,
  RUN_FAILURE_LABEL,
  NO_RUN_REASON,
  RUN_FAILURE_REASON_LABELS,
} from "../lib/run-failure.mjs";
import { createExecutionRun } from "../lib/execution-run-ledger.mjs";
import { executionRunDb } from "./helpers/execution-run-harness.mjs";

/**
 * The board's run-failure signal: derivation over the execution_runs ledger,
 * plus the wiring that carries it from the contract to the tile's one slot.
 *
 * Written from the requirements alone (spec-product_v3 acceptance criteria,
 * testing-strategy sections 5-7), against a real in-memory ledger — never a
 * mocked db, which would test the mock. The one exception is the fail-soft
 * case, where a throwing stub IS the behaviour under test.
 *
 * Source pins below constrain topology, counts and refusals only. A pin that
 * merely repeats a string from the implementation passes on an invisible chip
 * and is not used as if it guarded one; the rendered counterpart lives in
 * tests/run-failure-rendered.test.mjs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

// --- fixtures ---------------------------------------------------------------

const ROW = { id: "card_1", status: "in-progress" };

function seed(db, { id, cardId = "card_1", stage = "scope", status = "failed", error = "boom", at } = {}) {
  createExecutionRun(db, {
    id,
    cardId,
    projectId: "project_1",
    recipeId: "scope-map",
    stage,
    sourceHash: "hash",
    sourceText: "source",
    argsText: "{}",
    adapter: "bb-workflows",
    workspaceId: "/project",
    artifactRoot: `/project/.stelow/runs/${id}`,
    originThreadId: "thread_1",
  });
  if (status !== "queued" || error !== "boom" || at !== undefined) {
    db.prepare("UPDATE execution_runs SET normalized_status = ?, error_code = ? WHERE id = ?").run(status, error, id);
  }
  if (at !== undefined) {
    db.prepare("UPDATE execution_runs SET created_at = ? WHERE id = ?").run(at, id);
  }
}

// --- the label --------------------------------------------------------------

test("the chip names the run, not the worker", () => {
  // A second "Stopped"-shaped label here is how two reds start reading as one
  // subsystem; the label is the whole vocabulary lesson.
  assert.equal(RUN_FAILURE_LABEL, "Run failed");
});

// --- newest failed run ------------------------------------------------------

test("a failed newest run derives the chip with its mapped reason", () => {
  const db = executionRunDb("card_1");
  seed(db, { id: "exec_1", status: "failed", error: "native-start-timeout", at: 1_000 });
  const signal = runFailure(db, ROW);
  assert.equal(signal?.label, RUN_FAILURE_LABEL);
  // Mapped, not verbatim: compared against the map rather than a hardcoded
  // string, so the wording stays the map's decision and this stays a mapping
  // assertion rather than a copy pin.
  assert.equal(signal?.detail, RUN_FAILURE_REASON_LABELS["native-start-timeout"]);
  assert.notEqual(signal?.detail, "native-start-timeout");
});

test("a newer success clears an older failure", () => {
  // "A failed run exists" would mark healthy cards broken forever, and nothing
  // can delete the failed row to clear it — so only the newest run may speak.
  const db = executionRunDb("card_1");
  seed(db, { id: "exec_1", status: "failed", error: "boom", at: 1_000 });
  seed(db, { id: "exec_2", status: "succeeded", error: "boom", at: 2_000 });
  assert.equal(runFailure(db, ROW), null);
});

for (const status of ["queued", "running", "needs_input", "succeeded", "cancelled"]) {
  test(`a newest ${status} run clears an older failure`, () => {
    // A retry in flight (queued), a decision pending (needs_input) and a
    // cancellation are all newer evidence than the failure — pressing Retry
    // blanks the chip mid-flight because it inserts a newer row.
    const db = executionRunDb("card_1");
    seed(db, { id: "exec_1", status: "failed", error: "boom", at: 1_000 });
    seed(db, { id: "exec_2", status, error: "boom", at: 2_000 });
    assert.equal(runFailure(db, ROW), null, `newest ${status} must read as clean`);
  });
}

test("a same-millisecond tie is decided by insertion order", () => {
  // listExecutionRuns orders by created_at alone and SQLite promises no order
  // for a tie, so rowid DESC is load-bearing rather than decorative.
  const db = executionRunDb("card_1");
  seed(db, { id: "exec_1", status: "failed", error: "first-boom", at: 1_000 });
  seed(db, { id: "exec_2", status: "failed", error: "second-boom", at: 1_000 });
  assert.equal(runFailure(db, ROW)?.detail, "second-boom", "the later-inserted row wins, every time");
});

test("a failed run at another stage still surfaces, naming no stage", () => {
  // Card-scoped by design, not stage-scoped: a badge that vanished the moment
  // the card moved would be the opposite of visible without opening it.
  const db = executionRunDb("card_1");
  seed(db, { id: "exec_1", stage: "tech", status: "failed", error: "relay-boom", at: 1_000 });
  const signal = runFailure(db, ROW);
  assert.equal(signal?.label, RUN_FAILURE_LABEL);
  assert.ok(!signal?.detail.includes("tech"), "the tile names the state, never the stage");
});

test("runs for other cards do not leak across", () => {
  const db = executionRunDb("card_1");
  db.prepare("INSERT INTO cards (id) VALUES (?)").run("card_2");
  seed(db, { id: "exec_1", cardId: "card_2", status: "failed", error: "boom", at: 1_000 });
  assert.equal(runFailure(db, ROW), null, "card_1 has no runs of its own");
  assert.equal(
    runFailure(db, { id: "card_2", status: "in-progress" })?.label,
    RUN_FAILURE_LABEL,
    "card_2 reads its own failure",
  );
});

test("a card with no runs derives nothing", () => {
  assert.equal(runFailure(executionRunDb("card_1"), ROW), null);
});

// --- the raw fact -----------------------------------------------------------

test("lastRunFailure returns the raw code, mapped nowhere", () => {
  const db = executionRunDb("card_1");
  seed(db, { id: "exec_1", status: "failed", error: "native-start-timeout", at: 1_000 });
  assert.deepEqual(lastRunFailure(db, "card_1"), { errorCode: "native-start-timeout" });
});

test("lastRunFailure is null unless the newest run failed", () => {
  const db = executionRunDb("card_1");
  assert.equal(lastRunFailure(db, "card_1"), null, "no runs at all");
  seed(db, { id: "exec_1", status: "succeeded", error: "boom", at: 1_000 });
  assert.equal(lastRunFailure(db, "card_1"), null, "newest run succeeded");
});

test("lastRunFailure keeps a failed run whose code is null", () => {
  // The TYPE allows { errorCode: null } and the missing-reason rule needs it:
  // a null code is a failure recorded without a reason, not a clean card.
  const db = executionRunDb("card_1");
  seed(db, { id: "exec_1", status: "failed", error: null, at: 1_000 });
  assert.deepEqual(lastRunFailure(db, "card_1"), { errorCode: null });
});

// --- the missing reason -----------------------------------------------------

test("a null code states the missing reason, never an empty chip", () => {
  const db = executionRunDb("card_1");
  seed(db, { id: "exec_1", status: "failed", error: null, at: 1_000 });
  assert.equal(runFailure(db, ROW)?.detail, NO_RUN_REASON);
});

test("a blank code states the missing reason too", () => {
  const db = executionRunDb("card_1");
  seed(db, { id: "exec_1", status: "failed", error: "   ", at: 1_000 });
  assert.equal(runFailure(db, ROW)?.detail, NO_RUN_REASON);
  assert.equal(runFailureDetail(undefined), NO_RUN_REASON);
  assert.notEqual(runFailureDetail("   "), "");
});

test("the missing-reason constant is stated words, not an instruction", () => {
  // The board names; the detail explains. An instruction to open the card
  // belongs to the worker's own stop sentence, never to this tile constant.
  assert.ok(NO_RUN_REASON.trim().length > 0, "never an empty title");
  assert.doesNotMatch(NO_RUN_REASON, /open the card/i, "never an instruction to go and look");
  assert.equal(runFailureDetail(null), NO_RUN_REASON, "the chip detail IS the constant, verbatim");
});

// --- terminal cards ---------------------------------------------------------

for (const status of ["completed", "archived", "blocked"]) {
  test(`a ${status} card derives nothing, judged on the raw row`, () => {
    // Terminality reads row.status through isClaimTerminal. Judging the
    // PROJECTED status instead makes the blocked arm unreachable, because
    // readCardStatus maps every unknown status (including blocked) to draft.
    const db = executionRunDb("card_1");
    seed(db, { id: "exec_1", status: "failed", error: "boom", at: 1_000 });
    assert.equal(runFailure(db, { id: "card_1", status }), null, `${status} never wears the badge`);
  });
}

// --- fail-soft --------------------------------------------------------------

test("a throwing read derives null and never throws", () => {
  // Three board load paths swallow a rejected listCards into an empty board,
  // so an unguarded throw here is no board with no error message.
  const throwing = { prepare: () => { throw new Error("ledger unavailable"); } };
  assert.doesNotThrow(() => runFailure(throwing, ROW));
  assert.equal(runFailure(throwing, ROW), null);
  assert.equal(lastRunFailure(throwing, "card_1"), null);
});

// --- the reason map ---------------------------------------------------------

test("this plugin's own slugs map to prose", () => {
  // Unknown and host-supplied values pass through unchanged — inventing
  // English for a code this plugin does not own would fabricate a diagnosis.
  assert.equal(runFailureDetail("native-start-failed"), RUN_FAILURE_REASON_LABELS["native-start-failed"]);
  assert.equal(runFailureDetail("custom-exotic-9"), "custom-exotic-9");
  assert.equal(
    runFailureDetail("the host reported a failure without a reason"),
    "the host reported a failure without a reason",
    "a host sentence reaches the tile un-fabricated",
  );
});

test("every slug a writer stores has a translation", () => {
  // The closed-map rule, asked of both sides: each errorCode literal a writer
  // stores must be a key of the map, or a raw slug leaks onto the tile.
  // Sentence-like values (containing spaces) pass through by design.
  const literals = [];
  for (const file of [...readdirSync(join(root, "server")).filter((f) => f.endsWith(".ts")).map((f) => join("server", f)),
    ...readdirSync(join(root, "lib")).filter((f) => f.endsWith(".mjs")).map((f) => join("lib", f))]) {
    for (const match of read(file).matchAll(/errorCode:\s*"([^"]+)"/g)) literals.push(match[1]);
  }
  const slugs = [...new Set(literals)].filter((literal) => !/\s/.test(literal));
  assert.ok(slugs.length > 0, "the writers store slug codes to check against");
  for (const slug of slugs) {
    assert.ok(
      typeof RUN_FAILURE_REASON_LABELS[slug] === "string" && RUN_FAILURE_REASON_LABELS[slug].trim().length > 0,
      `writer stores "${slug}" with no translation — it would reach the tile as a raw slug`,
    );
  }
});

test("a long host reason truncates, and no mapped phrase can be cut in half", () => {
  const long = `host.detail.${"x".repeat(188)}`;
  const detail = runFailureDetail(long);
  assert.equal(detail.length, 180, "the shared card-surface cap");
  assert.ok(detail.endsWith("…"), "truncation marks itself");
  // The order guard made structural: truncation applies AFTER mapping, so a
  // mapped phrase longer than the cap would be sliced. All mapped values fit
  // inside it today, which is what makes the order unobservable — and what
  // must stay true for it to remain so.
  for (const [code, prose] of Object.entries(RUN_FAILURE_REASON_LABELS)) {
    assert.ok(prose.trim().length > 0, `"${code}" maps to words, not a blank`);
    assert.ok(prose.length <= 180, `"${code}" maps to ${prose.length} chars — beyond the cap a mapped phrase truncates`);
  }
});

// --- wiring: the gate -------------------------------------------------------

const boardCards = read("components/board/board-cards.tsx");

function showAlertsGate() {
  const start = boardCards.indexOf("const showAlerts");
  assert.ok(start >= 0, "CardMetaRows still declares its gate");
  const end = boardCards.indexOf("cardNeedsReview(card);", start);
  assert.ok(end >= 0, "the gate still ends at the review term");
  return boardCards.slice(start, end);
}

test("the alert row's gate names the run source", () => {
  // The v1/v2 critical, as a structural sibling to the rendered only-alert
  // case: the gate used to test only the worker source, so the row stayed
  // absent on precisely the card the chip was built for. A pin that reads chip
  // order alone cannot see this gate at all, which is why it is asserted over
  // the term list instead.
  assert.match(
    showAlertsGate(),
    /card\.runFailure != null/,
    "the gate tests the run source explicitly — a refactor of the slot variable must not silently drop it",
  );
});

// --- wiring: the one slot ---------------------------------------------------

function alertRow() {
  const start = boardCards.indexOf("mt-2 flex min-w-0 flex-wrap items-center gap-1.5");
  assert.ok(start >= 0, "the alert row is still the wrapping flex row");
  const end = boardCards.indexOf("\n        </div>", start);
  assert.ok(end > start, "the row still closes before the project line");
  return boardCards.slice(start, end);
}

function branchComponents(row) {
  return [...row.matchAll(/\{\s*[^?{}]*\?\s*\(?\s*<([A-Z][A-Za-z]*)/g)].map((match) => match[1]);
}

test("the alert row holds exactly six branches in order, one failure slot", () => {
  // One slot, two sources, by standing human approval: a second chip beside
  // ErrorChip is drift, not a new suggestion. A seventh branch at ANY position
  // — including a duplicated failure branch — fails this; reordering fails it.
  assert.deepEqual(branchComponents(alertRow()), [
    "ReasonPopover",
    "PausedChip",
    "AttentionChip",
    "IntegrationPendingChip",
    "DoingNowPill",
    "ReviewChip",
  ]);
});

test("the worker wins the slot, and the slot never mentions attention", () => {
  // Two broken subsystems with different remedies read as one red here, with
  // the actionable worker state first. Routing needsAttention into this branch
  // would put the amber vocabulary inside the red slot.
  assert.match(boardCards, /errorActivityLabel\(card\) \?\? card\.runFailure/, "the worker thread's failure wins the slot");
  assert.doesNotMatch(boardCards, /card\.runFailure \?\? errorActivityLabel\(card\)/, "the precedence never flips");
  const slotLines = boardCards.split("\n").filter((line) => line.includes("?? card.runFailure"));
  assert.ok(slotLines.length > 0, "the slot expression is present");
  for (const line of slotLines) {
    assert.ok(!line.includes("needsAttention"), "the failure slot answers failure, never attention");
  }
});

test("the chip reuses ErrorChip through the wrapper, never directly", () => {
  // The tap reveal wraps ErrorChip; a second red grown beside it would be the
  // rejected two-chip design arriving through the tile.
  assert.ok(alertRow().includes("<ReasonPopover"), "the slot renders through the reveal wrapper");
  assert.ok(!alertRow().includes("<ErrorChip"), "no bare ErrorChip beside the wrapper — two reds stay structurally impossible");
});

test("both card roots name the failure reason in their accessible description", () => {
  // Both roots are role=button, which makes descendants presentational to
  // assistive tech — so the card's own label is the only channel that carries
  // the reason there, on BOTH roots (BoardCard and LightweightTrackCard).
  const roots = boardCards.match(/aria-label=\{`Open (card|\$\{ariaNoun\})/g) ?? [];
  assert.equal(roots.length, 2, "both card roots still declare an accessible label");
  const named = boardCards.match(/failureSentence \? ` \$\{failureSentence\}` : ""/g) ?? [];
  assert.equal(named.length, 2, "both roots interpolate the same failure sentence — dropping one silences the reason for AT");
});

// --- wiring: contract and projection ----------------------------------------

test("listCards carries a nullable runFailure beside activity", () => {
  // The board can only show a signal the list carries. Beside activity, never
  // inside it: folding a ledger fact into the thread verdict would erase the
  // last verified projection the board is showing.
  const contract = read("server/card-rpc-contract.ts");
  assert.match(
    contract,
    /runFailure:\s*z\s*\.object\(\{\s*label:\s*z\.string\(\),\s*detail:\s*z\.string\(\),\s*\}\)\s*\.nullable\(\)/,
    "the contract declares the nullable { label, detail } object",
  );
  assert.ok(
    contract.indexOf("runFailure:") > contract.indexOf("activity: z.enum"),
    "the field travels beside activity, in the same output object",
  );
});

test("the projection spreads the derivation beside activity without rerouting it", () => {
  // cardSignals exists for the line budget (enrichCard sat at 49 of 50), not
  // for taste — and the extraction must stay additive: needsAttention and
  // activity keep their own derivations, untouched.
  const projection = read("server/cards.ts");
  assert.match(projection, /runFailure: runFailure\(deps\.db, row\)/, "the signal is derived from the RAW row");
  assert.doesNotMatch(projection, /runFailure\(deps\.db, card/, "never from the projected card, where blocked cannot appear");
  assert.match(projection, /\.\.\.cardSignals\(deps, row\)/, "enrichCard spreads the four signals in one line");
  assert.match(projection, /needsAttention: attention !== null/, "the attention derivation is not rerouted through the spread");
});

test("errorActivityLabel still knows nothing about runs", () => {
  // A later author widening errorActivityLabel to include run failures would
  // put a host reason into the hero and the inbox — the tile owns that fork,
  // and this is the pin that refuses the widening.
  const source = read("lib/detail-presentation.mjs");
  const start = source.indexOf("export function errorActivityLabel");
  assert.ok(start >= 0, "errorActivityLabel is still declared where the tile imports it from");
  const body = source.slice(start, source.indexOf("\nexport function", start + 1) >= 0
    ? source.indexOf("\nexport function", start + 1)
    : source.length);
  assert.doesNotMatch(body, /runFailure/i, "the worker vocabulary never absorbs the run signal");
});
