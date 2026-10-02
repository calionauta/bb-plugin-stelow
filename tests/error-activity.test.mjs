import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { liveBorderClass, errorActivityLabel } from "../lib/detail-presentation.mjs";

// A stopped card must not look like a card waiting for an answer.
//
// card_e3u00eb4 stopped on purpose — the worker said it would not start a cycle
// it could not finish — and the board gave it the amber attention border, the
// same one a question gets, and no label at all. Every case below is that
// board, frozen.

const here = dirname(fileURLToPath(import.meta.url));

const ERROR = { activity: "error", lastError: "Workflow state ownership cannot be verified." };
const QUESTION = { activity: "awaiting-answer", needsAttention: true, lastError: null };
const RUNNING = { activity: "running", needsAttention: true, lastError: null };
const IDLE_OK = { activity: "idle", needsAttention: false, lastError: null };

// --- an error is never the attention border --------------------------------

assert.equal(liveBorderClass(ERROR), "stelow-border-error",
  "a stopped card must not borrow the border of a card waiting for an answer");
assert.notEqual(liveBorderClass(ERROR), liveBorderClass(QUESTION),
  "an error and a question are different calls to action");

// --- an error outranks attention ------------------------------------------
// needsAttention is true for an error, so a card that is both must still read
// as an error. The order of the branches is the whole fix.

assert.equal(liveBorderClass({ ...ERROR, needsAttention: true }), "stelow-border-error",
  "attention must not outrank an error");

// --- the other three keep their borders ------------------------------------

assert.equal(liveBorderClass(RUNNING), "stelow-border-running", "a running card still pulses blue");
assert.equal(liveBorderClass(QUESTION), "stelow-border-attention", "a question still pulses amber");
assert.equal(liveBorderClass(IDLE_OK), "", "a settled card has no border at all");
assert.equal(liveBorderClass({ activity: "idle", needsAttention: true, lastError: null }),
  "stelow-border-attention", "an idle card wanting eyes keeps the attention border");

// --- the border classes are distinct ---------------------------------------

const tones = new Set([
  liveBorderClass(ERROR), liveBorderClass(RUNNING),
  liveBorderClass(QUESTION), liveBorderClass(IDLE_OK),
]);
assert.equal(tones.size, 4, "each state gets its own border class");

// --- a stopped card says so -----------------------------------------------

const stopped = errorActivityLabel(ERROR);
assert.ok(stopped, "a stopped card must say it stopped");
assert.equal(stopped.label, "Stopped with an error");
assert.equal(stopped.detail, "Workflow state ownership cannot be verified.");

// --- an error with no recorded reason still says it stopped ---------------
// This is card_e3u00eb4 exactly: activity error, last_error empty.

const reasonless = errorActivityLabel({ activity: "error", lastError: "" });
assert.ok(reasonless, "an error with an empty reason is still an error, not a silent card");
assert.equal(reasonless.label, "Stopped");
assert.match(reasonless.detail, /without recording a reason/,
  "the reader is told the reason is missing rather than shown nothing");

const whitespace = errorActivityLabel({ activity: "error", lastError: "   " });
assert.equal(whitespace.label, "Stopped", "whitespace is not a reason");

// --- a card that is not stopped says nothing ------------------------------

for (const card of [QUESTION, RUNNING, IDLE_OK]) {
  assert.equal(errorActivityLabel(card), null,
    `a ${card.activity} card must not claim it stopped`);
}

// --- the stylesheet must know the class exists -----------------------------
// A border class with no rule is a silent no-op, and the class name is the
// only thing connecting the two files.

const css = readFileSync(
  join(here, "..", "components/app-support/stelow-styles.css"),
  "utf8",
);
assert.match(css, /stelow-border-error/, "the error border has a rule");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*stelow-border-error/,
  "the error border survives reduced motion — a still card must still read as stopped");

console.log("error activity test ok: a stopped card is red, named, and never mistaken for a question");
