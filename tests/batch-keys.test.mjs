/**
 * The keyboard accelerator for a question batch: which key means what, and —
 * more importantly — which keys it must NOT claim.
 *
 * The card is answerable by mouse today. These keys are the accelerator, and
 * the accelerator is where a keyboard layer usually goes wrong, in two ways
 * this file exists to prevent:
 *
 *  1. **Stealing keys from a text field.** The note is a text field. If a digit
 *     accelerator fires while the reader is typing, `3` jumps to question 3
 *     mid-sentence and `j` / `k` stop being letters. The inertness rule below
 *     is therefore the most-tested behaviour here, not an afterthought.
 *  2. **Swallowing keys the card does not use.** The card can render as a tab
 *     beside a live worker terminal. A layer that claims every keydown makes
 *     the terminal unusable, so an unhandled key returns null and the caller
 *     lets it through. `Tab`, `Escape` and browser chords are called out.
 *
 * The decisions are pure, so every rule is checked by a plain `node` test
 * rather than a rendered mount — the same reason the module lives in `lib/`.
 *
 * MUTATIONS RUN (each broken, seen red, then restored from a snapshot and
 * `diff`-confirmed identical):
 *  drop the isTextEntry guard            -> the text-field inertness tests
 *  allow Enter to submit without a chord -> "a bare Enter is a newline"
 *  let a digit ignore optionCount        -> "a digit with no option falls through"
 *  wrap moves instead of refusing at 0   -> "no wrap at either end"
 *  drop the meta/alt disqualifier        -> "browser chords fall through"
 *  make `s` unconditional               -> "skip only when it is offered"
 *  make `x` unconditional               -> "document only when there is one"
 *  return a decision for an unknown key  -> "an unrelated key falls through"
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BATCH_KEY_LEGEND, BATCH_KEY_LIST, batchKeyDecision } from "../lib/batch-keys.mjs";

/** A keydown-shaped event. `target` defaults to a plain container element. */
function key(keyName, { meta = false, ctrl = false, shift = false, alt = false, target } = {}) {
  return {
    key: keyName,
    metaKey: meta,
    ctrlKey: ctrl,
    shiftKey: shift,
    altKey: alt,
    target: target ?? { tagName: "DIV", isContentEditable: false },
  };
}

const INPUT = { tagName: "INPUT", isContentEditable: false };
const TEXTAREA = { tagName: "TEXTAREA", isContentEditable: false };
const SELECT = { tagName: "SELECT", isContentEditable: false };
const EDITABLE = { tagName: "DIV", isContentEditable: true };

/** The context a three-question batch with three options on the current one has. */
const ctx = (over = {}) => ({
  questionIndex: 1,
  questionCount: 3,
  optionCount: 3,
  canSkip: true,
  hasDocument: true,
  ...over,
});

const decide = (event, context = ctx()) => batchKeyDecision(event, context);

test("each digit picks its own option, zero-based", () => {
  // Off-by-one here is invisible in review and wrong every single time: "1"
  // must pick the first option, not the second.
  assert.deepEqual(decide(key("1")), { type: "pick", optionIndex: 0 }, '"1" picks the FIRST option');
  assert.deepEqual(decide(key("2")), { type: "pick", optionIndex: 1 }, '"2" picks the second');
  assert.deepEqual(decide(key("3")), { type: "pick", optionIndex: 2 }, '"3" picks the third');
  // The whole range, because a broken map usually breaks at the ends.
  for (let digit = 1; digit <= 9; digit += 1) {
    assert.deepEqual(
      batchKeyDecision(key(String(digit)), ctx({ optionCount: 9 })),
      { type: "pick", optionIndex: digit - 1 },
      `every digit in the advertised range is wired: "${digit}"`,
    );
  }
});

test("a digit with no option behind it falls through instead of answering", () => {
  // A one-option question must not answer itself because someone typed "7".
  // Returning null (not a clamped pick) is what makes the caller let the key
  // reach the browser, and is the difference between "no opinion" and "wrong".
  assert.equal(decide(key("7"), ctx({ optionCount: 3 })), null, 'a digit past the last option is not a near miss: "7" on a 3-option question is refused');
  assert.equal(decide(key("4"), ctx({ optionCount: 3 })), null, "the boundary digit is refused");
  assert.deepEqual(decide(key("3"), ctx({ optionCount: 3 })), { type: "pick", optionIndex: 2 }, "the last real option is still pickable");
  assert.equal(decide(key("1"), ctx({ optionCount: 0 })), null, "a question with no options accepts no digit");
});

test("the reader typing in a note owns the keyboard", () => {
  // THE rule. Without it, writing "3 items" jumps to question 3 and every
  // letter command fires while the person is writing prose.
  for (const [name, target] of [["input", INPUT], ["textarea", TEXTAREA], ["select", SELECT], ["contenteditable", EDITABLE]]) {
    for (const k of ["1", "3", "j", "k", "o", "s", "x"]) {
      assert.equal(
        decide(key(k, { target }), ctx({ canSkip: true, hasDocument: true })),
        null,
        `"${k}" must reach the field, not the accelerator — typed inside ${name}`,
      );
    }
    for (const k of ["ArrowLeft", "ArrowRight"]) {
      assert.equal(decide(key(k, { target }), ctx()), null, `${k} is the caret moving inside ${name}, not a question change`);
    }
    // "?" is a character a person types. Revealing the key list instead of
    // writing the question mark is the same bug as "3" jumping questions.
    assert.equal(decide(key("?", { target })), null, `"?" must be typed into ${name}, not open the key list`);
  }
});

test("the one key that survives a text field is the save chord", () => {
  // A reader must be able to submit from inside the note without tabbing out,
  // and this chord already means "save" in the card's description editor — so
  // the card teaches one chord, not two.
  assert.deepEqual(decide(key("Enter", { meta: true, target: TEXTAREA })), { type: "submit" }, "Cmd+Enter submits from inside the note");
  assert.deepEqual(decide(key("Enter", { ctrl: true, target: INPUT })), { type: "submit" }, "Ctrl+Enter does the same on a non-Mac keyboard");
  assert.deepEqual(decide(key("Enter", { meta: true })), { type: "submit" }, "and from a plain target");
});

test("a bare Enter is the reader's newline, never a submit", () => {
  // Inside a note, Enter breaks the line. Anywhere else, submitting on a bare
  // Enter would fire while someone is tabbing through options.
  assert.equal(decide(key("Enter")), null, "a bare Enter must not submit");
  assert.equal(decide(key("Enter", { shift: true })), null, "Shift+Enter is a newline too");
  assert.equal(decide(key("Enter", { shift: true, meta: true })), null, "Shift disqualifies the chord so exactly one combination means submit");
  assert.equal(decide(key("Enter", { target: TEXTAREA })), null, "Enter inside the note is a newline");
});

test("arrows and j/k move between questions and refuse at both ends", () => {
  assert.deepEqual(decide(key("ArrowRight")), { type: "move", toIndex: 2 }, "right is the next question");
  assert.deepEqual(decide(key("ArrowLeft")), { type: "move", toIndex: 0 }, "left is the previous one");
  assert.deepEqual(decide(key("j")), { type: "move", toIndex: 2 }, "j is the vi-style next");
  assert.deepEqual(decide(key("k")), { type: "move", toIndex: 0 }, "k is the vi-style previous");
  // No wrapping: a move that leaves the batch is refused, so the reader cannot
  // be silently teleported from the last question back to the first.
  assert.equal(decide(key("ArrowRight"), ctx({ questionIndex: 2 })), null, "the last question has no next");
  assert.equal(decide(key("ArrowLeft"), ctx({ questionIndex: 0 })), null, "the first question has no previous");
  assert.equal(decide(key("j"), ctx({ questionIndex: 2 })), null, "j refuses at the end too");
  assert.equal(decide(key("k"), ctx({ questionIndex: 0 })), null, "k refuses at the start");
  // One question means no navigation at all, in either direction.
  assert.equal(decide(key("ArrowRight"), ctx({ questionIndex: 0, questionCount: 1 })), null, "a single question has nowhere to move");
});

test("letters are case-insensitive so a held Shift is not a different app", () => {
  // Shift+/ is how "?" arrives at all, so a keyboard layer that only listens
  // for lowercase would already be inconsistent. Same rule for the letters.
  assert.deepEqual(decide(key("O")), { type: "focus-note" }, "a capital O focuses the note");
  assert.deepEqual(decide(key("S")), { type: "toggle-skip" }, "a capital S toggles skip");
  assert.deepEqual(decide(key("X")), { type: "open-document" }, "a capital X opens the document");
});

test("skip and document are offered only when they exist", () => {
  // The recovered (timed-out) batch has no skip, and a question with no
  // attached document has nothing to open. Claiming the key anyway would
  // swallow it and do nothing, which reads as a broken control.
  assert.deepEqual(decide(key("s")), { type: "toggle-skip" }, "skip works when the surface offers it");
  assert.equal(decide(key("s"), ctx({ canSkip: false })), null, "with no skip offered the key falls through");
  assert.deepEqual(decide(key("x")), { type: "open-document" }, "document opens when there is one");
  assert.equal(decide(key("x"), ctx({ hasDocument: false })), null, "with no document the key falls through");
});

test("? reveals the complete key list", () => {
  assert.deepEqual(decide(key("?")), { type: "show-keys" }, "? opens the full list");
});

test("keys the card does not use fall through, and browser chords are not claimed", () => {
  // The card can sit beside a live terminal: a layer that eats every keydown
  // makes that terminal unusable, so "no opinion" has to be reachable.
  for (const k of ["a", "Tab", "F5", "Escape", "PageDown", " ", "Backspace"]) {
    assert.equal(decide(key(k)), null, `"${k}" is not ours and must reach its default handler`);
  }
  // Ctrl+S saves the page, Cmd+O opens a file, Alt+Left is history. Claiming a
  // modified letter would break the browser and surprise nobody pleasantly.
  assert.equal(decide(key("s", { ctrl: true })), null, "Ctrl+S stays the browser's save");
  assert.equal(decide(key("o", { meta: true })), null, "Cmd+O stays the browser's open");
  assert.equal(decide(key("ArrowLeft", { alt: true })), null, "Alt+Left stays the browser's history");
  assert.equal(decide(key("1", { meta: true })), null, "a modified digit is a browser tab shortcut, not a pick");
});

test("garbage input degrades instead of throwing", () => {
  // Every field is read defensively because this is fed by a live event, and a
  // thrown error in a keydown handler breaks the whole card.
  assert.equal(batchKeyDecision(undefined, undefined), null, "no event at all");
  assert.equal(batchKeyDecision({}, ctx()), null, "an event with no key");
  assert.equal(batchKeyDecision({ key: "1" }, undefined), null, "a digit with no context claims nothing");
  // An ABSENT target is not a text field: only a real field makes the
  // accelerator go quiet, or a card rendered without one would accept no keys.
  assert.deepEqual(batchKeyDecision({ key: "o" }, ctx()), { type: "focus-note" }, "an event with no target at all is still live");
  assert.equal(batchKeyDecision(key("1"), { optionCount: "3" }), null, "a stringly option count is not a number of options");
});

test("the terse legend stays terse, and the complete list is where the rest live", () => {
  // Two lists, two jobs, and the split is the point. The legend is PERMANENT
  // chrome above the submit, so it carries only what a newcomer needs to get
  // unstuck; `?` opens the full list. A `?` that repeated the legend would be a
  // control that does nothing.
  assert.ok(BATCH_KEY_LEGEND.length <= 5, `the legend is terse, not a table: ${BATCH_KEY_LEGEND.length} entries`);
  const legend = BATCH_KEY_LEGEND.map((entry) => entry.keys).join(" ");
  assert.match(legend, /1-9/, "the legend names the pick range");
  assert.match(legend, /[\u2190\u2192]/, "and the movement keys, when there is more than one question");
  assert.match(legend, /\?/, "and where the rest of the keys are written down");
  assert.match(legend, /\u2318\/Ctrl\+\u21b5/, "and the submit chord");

  // Every key the router can act on is documented SOMEWHERE, and `j`/`k` are
  // the case that made this necessary: they were implemented in the router and
  // named in neither list, so a home-row-only reader could never learn them.
  const all = BATCH_KEY_LIST.map((entry) => entry.keys).join(" ");
  assert.match(all, /1-9/, "the list names the pick range");
  assert.match(all, /[\u2190\u2192]/, "and the arrow keys");
  assert.match(all, /j k/, "and the home-row equivalents the router implements");
  assert.match(all, /\bo\b/, "and the note key");
  assert.match(all, /\bs\b/, "and the skip key");
  assert.match(all, /\bx\b/, "and the document key");
  assert.match(all, /\?/, "and the key-list affordance itself");
  assert.match(all, /\u2318\/Ctrl\+\u21b5/, "and the submit chord");
  for (const entry of [...BATCH_KEY_LEGEND, ...BATCH_KEY_LIST]) {
    assert.ok(
      typeof entry.label === "string" && entry.label.length > 0,
      `every entry names what its key does, and ${entry.keys} does not`,
    );
  }
});

console.log("batch keys test ok: one decision per key, inert in a note, nothing swallowed");
