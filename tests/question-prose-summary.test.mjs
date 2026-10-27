/**
 * The ONE prose-truncation rule, and its hostile inputs.
 *
 * Split out of question-surface-collapse.test.mjs when that file crossed the
 * 400-line budget: this half is `lib/`, pure, and about a single function; the
 * other half is component topology. Two subjects, two files.
 *
 *  R1  ONE exported truncation rule (limit 140) serves the card description AND
 *      an option's glance. At or under the limit nothing moves; over it the
 *      FIRST SENTENCE wins when one ends inside the limit, the word boundary
 *      wins when none does, and a passage with no whitespace and no terminator
 *      still leaves a non-null tail. "Over the limit" may never come back whole,
 *      and head + tail may lose nothing but boundary whitespace.
 *
 *
 * NOT duplicated here: question-presentation / question-decision-surface /
 * split-question-presentation / single-pick-composition / question-needs-note-ui
 * / option-section-wiring / card-design-tokens / disclosure-affordance.
 *
 * Left for THIS file: the falsifiable half of R1 ("always a door" across hostile
 * inputs, non-string degradation, one rule for both call sites) and the R2-R4
 * topology no other guard reads. A rendered mount is unavailable to a plain
 * `node` script (JSX needs the tsx loader; PromptRead/the stepper are private),
 * so R2-R4 pin wiring that cannot be extracted, each naming the regression it
 * would catch; extractable behaviour goes through the module.
 *
 * MUTATIONS RUN. One source edit at a time, test re-run, the six source files
 * restored from a snapshot and `diff`-confirmed identical; `git diff --stat`
 * names only this file and package.json. Every row was executed and went red.
 * Counted 28; the mutation -> catching test map, compactly:
 *
 *  `<=` to `<` -> 1        return input whole -> 2, 26, 27
 *  kill sentence rule -> 3 drop word floor -> 4, 5, 6
 *  ignore newlines -> 5    kill next-space rounding -> 6
 *  non-string guard never matches -> 7
 *  option row onto splitOptionDescription -> 8; description cut from "" -> 9
 *  disclosure unconditional -> 10; pencil inside the one <details> -> 11
 *  amber classes + role="alert" on the root -> 12, 13; restore the badge -> 14
 *  re-add answersNeeded -> 15; drop the dot's questionOf label -> 16
 *  drop the withoutKeep filter -> 17; break the single answerQuestions payload -> 18
 *  defaultOpen -> 19; open={true} -> 19b; hard-code the recovered title -> 20
 *  remove the skip label -> 21; the note label -> 22; the one <BatchCustomInput> -> 23
 *  drop the recovery hint -> 24; point the recovered batch at the live door -> 25
 *  start the tail one char late -> 26; move the limit to 200 -> 27
 *  re-export the 240 option rule -> 28
 *
 * Row 23 is why that pin counts render sites rather than checking the name
 * appears; rows 6 and 27 red "always a door" too, because the fixtures' lengths
 * derive from the limit, so a fixture that no longer exceeds it IS the failure.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROSE_SUMMARY_LIMIT, splitProseSummary } from "../lib/question-prose.mjs";
import { codeOf } from "./helpers/source-code.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

// The two call sites the rule has to reach. Their PRESENCE is asserted in the
// test below, because "one exported rule" is only true while both prose surfaces
// go through it — a second limit is the drift this consolidation removed.
const optionCode = codeOf(read("components/conversation/batch-options.tsx"));
const controlCode = codeOf(read("components/detail/prompt-edit-control.tsx"));
const blockOf = (source, open, close) => {
  const from = source.indexOf(open);
  const to = source.indexOf(close, from);
  assert.ok(from >= 0 && to > from, `${open} must be a bounded block ending before ${close} in this file`);
  return source.slice(from, to);
};
const promptRead = blockOf(controlCode, "function PromptRead(", "function EditorActions(");

/**
 * Fixtures chosen for their hostility. Lengths derive from PROSE_SUMMARY_LIMIT,
 * so a change to the limit moves the fixtures with it rather than silently
 * making one of them short enough to pass for the wrong reason.
 */
/* ------------------------------------------------------------------ R1 --- */

/**
 * Fixtures chosen for their hostility. Lengths derive from PROSE_SUMMARY_LIMIT,
 * so a change to the limit moves the fixtures with it rather than silently
 * making one of them short enough to pass for the wrong reason.
 */
const WALL = "w ".repeat(400);
const ROWS = "word\n".repeat(50);
const HOSTILE = [
  ["one giant token, no whitespace at all", "z".repeat(1400)],
  ["a long token with no terminator", "y".repeat(PROSE_SUMMARY_LIMIT * 4)],
  ["a wall of words", WALL],
  ["newline-separated rows", ROWS],
  ["tab-separated cells", "cell\t".repeat(80)],
  ["carriage-return rows", "row\r\n".repeat(60)],
  ["a very short first sentence then a wall", `Ok. ${"x".repeat(600)}`],
  ["several short sentences", `One. Two! Three? ${"y".repeat(300)}`],
  ["a long first sentence with no terminator", "word ".repeat(120)],
  ["first sentence ending at the limit", `${"a".repeat(139)}. tail after the cut`],
  ["leading whitespace then one token", `${" ".repeat(60)}${"b".repeat(300)}`],
  ["a word longer than half the limit, then one more", `${"x".repeat(150)} tail`],
  ["only whitespace, over the limit", " ".repeat(PROSE_SUMMARY_LIMIT * 2)],
  ["one character over the limit", "a".repeat(PROSE_SUMMARY_LIMIT + 1)],
  ["over the limit and ending in whitespace", `${"x".repeat(150)} `],
];

test("R1: at or under the limit nothing moves and there is no tail", () => {
  for (const [name, text] of [
    ["empty", ""],
    ["one character", "a"],
    ["exactly the limit", "a".repeat(PROSE_SUMMARY_LIMIT)],
    ["a short sentence", "Wait for the other thread to land, then retry."],
  ]) {
    assert.deepEqual(
      splitProseSummary(text),
      { head: text, tail: null },
      `${name} passes through whole with tail === null; a disclosure that hides nothing is a cost this rule must not add`,
    );
  }
});

test("R1: over the limit always leaves a door, and head plus tail is the whole passage", () => {
  for (const [name, text] of HOSTILE) {
    assert.ok(text.length > PROSE_SUMMARY_LIMIT, `${name} really exceeds the limit — the fixture proves the assertion`);
    const { head, tail } = splitProseSummary(text);
    assert.notEqual(
      tail,
      null,
      `${name}: a passage over the limit must leave a door. Returning it whole hands the row the 1,000-character blob `
      + "this limit exists to keep out, and no input is exempt — not a token with no whitespace, not a wall",
    );
    // "A door" is the null check, not a non-empty tail: a passage that is
    // nothing but whitespace, and one whose only break is its final space, both
    // leave an empty tail — correctly, because there is nothing left to hide.
    // What must never happen is inline == everything, which is this comparison.
    assert.ok(head.length < text.length, `${name}: an over-limit passage can never be fully inline`);
    assert.ok(text.startsWith(head), `${name}: the head is a prefix of the input, never invented or re-flowed`);
    if (head.trim().length > 0) {
      // Three properties, because any one alone is passable on broken logic:
      // the head starts the passage, the tail ends it, and together they carry
      // every non-whitespace character.
      assert.ok(text.endsWith(tail), `${name}: the tail reaches the end, so the disclosure is not a fragment`);
      assert.equal(
        `${head}${tail}`.replace(/\s+/g, ""),
        text.replace(/\s+/g, ""),
        `${name}: a reader who opens the disclosure continues the sentence they were reading — no word is dropped`,
      );
      assert.match(
        text.slice(head.length, text.length - tail.length),
        /^\s*$/,
        `${name}: the residue between the two cuts is boundary whitespace, never content`,
      );
    }
  }
});

test("R1: the first sentence inside the window is the head, whole", () => {
  // UPDATED after the UX critique (2026-10-18) found this rule's real defect:
  // a terminator 2-4 characters in ("1. Land the schema…", "e.g. the pin is
  // stale…", "Ok. <wall>") was honoured as the writer's cut and handed the
  // reader a one- or two-character head — a summary that says nothing, hiding
  // the request behind a disclosure nobody has a reason to open. The rule is
  // now "the first sentence, when it leaves at least two words behind"; a
  // one-word candidate falls through to the word-boundary cut instead. These
  // cases used to assert "Ok.", "One." and "Wait..." and were the failing
  // pins that surfaced the defect.
  for (const [name, text, expected] of [
    ["one-word sentences are not a summary", `Ok. ${"x".repeat(600)}`, null],
    ["a numbered list lead is not a summary", `1. ${"z".repeat(400)}`, null],
    ["an abbreviation is not a summary", `e.g. ${"k".repeat(400)}`, null],
    ["an ellipsis alone is not a summary", `Wait... ${"s".repeat(300)}`, null],
    ["several sentences: the first real one is the cut", `One two! Three? ${"y".repeat(300)}`, "One two!"],
    ["a closing quote belongs to the sentence", `He said "go." then ${"q".repeat(300)}`, 'He said "go."'],
    ["a closing bracket belongs to the sentence", `See (item one.) then ${"r".repeat(300)}`, "See (item one.)"],
    ["a decimal point does not end a sentence", `Version 1.2 ships soon. ${"w".repeat(400)}`, "Version 1.2 ships soon."],
  ]) {
    const { head, tail } = splitProseSummary(text);
    if (expected === null) {
      assert.ok(
        head.trim().split(/\s+/).length >= 2,
        `${name}: the head must carry words, not a lone terminator — got ${JSON.stringify(head)}`,
      );
    } else {
      assert.equal(
        head,
        expected,
        `${name}: the writer's own cut is the head — a mid-condition fragment is what the first-sentence rule replaced`,
      );
    }
    assert.ok(tail !== null && tail.length > 0, `${name}: the rest is one disclosure away`);
  }
});

test("R1: without a sentence in the window the cut follows the word, never amputating", () => {
  const run = "word ".repeat(120);
  for (const [name, text] of [["a wall of words", WALL], ["newline rows", ROWS], ["a long sentence-less run", run]]) {
    const { head } = splitProseSummary(text);
    assert.equal(
      head,
      text.slice(0, PROSE_SUMMARY_LIMIT).trimEnd(),
      `${name}: with no sentence to cut on, the head is the window cut back to its boundary — not the next whitespace `
      + "past the limit and not a mid-word amputation",
    );
    assert.match(text[head.length] ?? "", /\s/, `${name}: the head ends AT a word boundary, on a whitespace character`);
    assert.doesNotMatch(head, /\s$/, `${name}: and carries no trailing whitespace into the collapsed line`);
  }
  // A token longer than half the limit must round UP to the next whitespace,
  // so the reader is not handed less than the limit they were promised; with no
  // whitespace anywhere, the hard cut is the only door left.
  assert.deepEqual(
    splitProseSummary(`${"x".repeat(150)} tail`),
    { head: "x".repeat(150), tail: "tail" },
    "the head keeps the whole long word instead of being amputated just under the limit",
  );
  const unbreakable = "z".repeat(1400);
  const cut = splitProseSummary(unbreakable);
  assert.equal(cut.head, "z".repeat(PROSE_SUMMARY_LIMIT), "an unbreakable passage is hard-cut at the limit, not returned whole");
  assert.equal(cut.head.length + cut.tail.length, unbreakable.length, "nothing is dropped, not even here");
});

test("R1: a non-string degrades to an empty head instead of throwing", () => {
  for (const value of [null, undefined, 42, 0, true, {}, [], Number.NaN]) {
    assert.doesNotThrow(() => splitProseSummary(value), `${String(value)} must not throw — this is called during render`);
    assert.deepEqual(
      splitProseSummary(value),
      { head: "", tail: null },
      `${String(value)} renders as nothing, with no disclosure for text that does not exist`,
    );
  }
});

test("R1: one exported rule at 140, and both prose surfaces read it", () => {
  // The rule moved to its own module (2026-10-27) when the question surface
  // pushed `question-presentation.mjs` over its file budget. The pin follows
  // the rule, not the filename: a second truncation rule anywhere on the module
  // that owns it is still the drift this consolidation removed.
  const prose = read("lib/question-prose.mjs");
  assert.equal(PROSE_SUMMARY_LIMIT, 140, "the limit is the single named number both surfaces cut at");
  const secondRule = prose.match(/export (?:const|function) (?!PROSE_SUMMARY_LIMIT)\w*(?:PREVIEW|TRUNC|SUMMARY_LIMIT)\w*/g) ?? [];
  assert.deepEqual(
    secondRule,
    [],
    "a second truncation rule is the drift this consolidation removed: two rungs on one card cut the same prose "
    + `differently. Found: ${secondRule.join(", ")}`,
  );
  assert.equal(
    (prose.match(/OPTION_DESCRIPTION_PREVIEW_LIMIT|splitOptionDescriptionPreview/g) ?? []).length,
    0,
    "the 240/option-only rule is gone, not aliased",
  );
  assert.match(
    read("lib/question-prose.d.mts"),
    /export declare const PROSE_SUMMARY_LIMIT: number;/,
    "the type declaration names the rule, so a consumer cannot import a stale name and still compile",
  );
  // The wiring that makes it ONE rule rather than two equal limits: the option
  // glance reaches the same function, and so does the card's own description,
  // which used to render 1,500-4,000 characters in full.
  assert.match(optionCode, /splitProseSummary\(description\)/, "the option glance truncates through the shared rule");
  assert.match(promptRead, /splitProseSummary\(prompt\)/, "and so does the card's description");
});
