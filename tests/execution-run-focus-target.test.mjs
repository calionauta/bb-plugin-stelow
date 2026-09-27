import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executionRunFocus, executionRunRowId } from "../lib/execution-deep-link.mjs";

/**
 * "Open" on an execution run navigates, and then has to land on something.
 *
 * The effect and the row used to disagree. The row took its DOM id from the deep
 * link's focus helper, which for a run waiting on a person returns the card's
 * question section — `execution-needs-input-questions`. So that id appeared
 * twice in the document (the run row and the question section), and the focus
 * effect, which hand-wrote `execution-run-<id>`, found nothing at all for a
 * needs_input run. `getElementById` returned undefined and
 * `target?.scrollIntoView()` was a no-op: the card opened and nothing happened.
 *
 * This is modelled rather than string-matched, because the failure was never a
 * missing string — it was two derivations of "which element" that did not
 * agree. A copy pin passes on exactly that bug.
 */

/** The question section is its own element; a run row is another. */
const QUESTION_SECTION_ID = "execution-needs-input-questions";

/**
 * Build the document the card would render: one row per run, plus the question
 * section when the card has one. `rowIdFor` is how the row names itself.
 */
function renderDocument(runs, rowIdFor) {
  const ids = runs.map((run) => rowIdFor(run.id)).filter(Boolean);
  ids.push(QUESTION_SECTION_ID);
  return new Set(ids);
}

const STATES = ["queued", "running", "needs_input", "succeeded", "failed", "cancelled"];
const runs = STATES.map((status) => ({ id: `exec_${status}`, status }));
const hasQuestion = (run) => run.status === "needs_input";

/** What the focus effect does: derive a target from the runs it has, look it up. */
function focusTargetFor(runsInScope, run, document) {
  const targetId = executionRunFocus({
    localRunId: run.id,
    status: run.status,
    hasQuestion: hasQuestion(run),
  });
  return targetId ? (document.has(targetId) ? targetId : null) : null;
}

// The behaviour under test: for EVERY run state, the link resolves to an element
// that is actually on the card.
{
  const document = renderDocument(runs, executionRunRowId);
  for (const run of runs) {
    assert.ok(
      focusTargetFor(runs, run, document),
      `a deep link to a ${run.status} run must land on a real element, not resolve to nothing`,
    );
  }
}

// A row names itself, and never borrows the question section's id — one id, one
// element, or `getElementById` returns whichever came first.
for (const run of runs) {
  const rowId = executionRunRowId(run.id);
  assert.ok(rowId, `a valid ledger id yields a row id (${run.id})`);
  assert.notEqual(
    rowId,
    QUESTION_SECTION_ID,
    `a ${run.status} run row must not claim the question section's id — two elements would share one`,
  );
}

// The two derivations stay distinct: a run waiting on a person aims at the
// answerable question, which is the whole point of that state.
assert.equal(
  executionRunFocus({ localRunId: "exec_needs_input", status: "needs_input", hasQuestion: true }),
  QUESTION_SECTION_ID,
  "a run waiting on a person opens the question, not the row",
);
for (const status of STATES.filter((state) => state !== "needs_input")) {
  assert.equal(
    executionRunFocus({ localRunId: `exec_${status}`, status, hasQuestion: false }),
    executionRunRowId(`exec_${status}`),
    `a ${status} run opens its own row`,
  );
}

// A question-less needs_input run falls back to its row, and lands on a real
// element — the "the run asked something the card could not read" case.
{
  const document = renderDocument(runs, executionRunRowId);
  const run = { id: "exec_needs_input", status: "needs_input" };
  const target = executionRunFocus({ localRunId: run.id, status: run.status, hasQuestion: false });
  assert.equal(target, executionRunRowId(run.id), "with no readable question, the row is the target");
  assert.ok(document.has(target), "and that row is on the card");
}

// Junk in, null out — never an id that would match some unrelated element.
for (const value of [undefined, null, 7, "", "exec_", "run-native", "exec_bad space"]) {
  assert.equal(executionRunRowId(value), null, `${JSON.stringify(value)} is not a run row id`);
}

// The model above is only worth something if the component actually wires it
// up, so the two derivations are pinned where they are used. These are topology
// pins on JSX and an effect body — wiring that cannot be lifted into a pure
// function — and each names the regression it catches.
const root = fileURLToPath(new URL("..", import.meta.url));
const rowSource = readFileSync(join(root, "components", "detail", "execution-runs-section.tsx"), "utf8");
const hookSource = readFileSync(join(root, "components", "detail", "use-execution-runs.ts"), "utf8");

assert.match(
  rowSource,
  /executionRunRowId\(run\.id\)/,
  [
    "a run row names itself with executionRunRowId; borrowing executionRunFocus",
    "here put the question section's id on the row too, so getElementById",
    "matched two elements for one run",
  ].join(" "),
);
assert.doesNotMatch(
  rowSource,
  /executionRunFocus\(/,
  "the row must not derive its id from the deep link's focus target — that conflation is what this test exists for",
);
assert.match(
  hookSource,
  /executionRunFocus\(/,
  [
    "the focus effect derives its target from the shared helper; the",
    "hand-written execution-run-<id> found nothing for a needs_input run",
    "and silently did nothing",
  ].join(" "),
);
assert.doesNotMatch(
  hookSource,
  /block: "nearest"/,
  [
    'block: nearest is defined to move nothing when the target is already',
    "on screen, and focus({preventScroll}) suppressed the only other scroll",
    "— so Open produced no observable change at all",
  ].join(" "),
);
assert.doesNotMatch(
  hookSource,
  /preventScroll/,
  "focus({preventScroll}) suppresses the only scroll a deep link had, which is the other half of why Open moved nothing",
);
assert.match(
  rowSource,
  /outline-primary/,
  "the opened row must be visible: a deep link that lands silently is indistinguishable from a button that does nothing",
);

console.log("execution run focus test ok: a run deep link always lands on a real element, and no two share an id");
