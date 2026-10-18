import assert from "node:assert/strict";
import { askShapeRefusal, SINGLE_SELECT_MAX_OPTIONS } from "../lib/question-gate.mjs";
import { decideAskGate } from "../lib/question-gate.mjs";

// Shape rules are authority-free: a radio with too many rows, or a one-choice
// question recommending several of its own options, is malformed whoever asked
// and in whatever review mode (issue #384). `askShapeRefusal` is the single
// decision point for both, so every row below fails if a rule is deleted,
// widened to multi-select, or made to fire on a legal shape.

assert.equal(SINGLE_SELECT_MAX_OPTIONS, 6, "the shared ceiling is six: raising it would silently re-admit the 7-row radio from issue #384");

const labels = (count, prefix = "Option") => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
const single = (count, options) => ({
  groups: [{ question: "Which approach ships first?", multiple: false, options: options ?? labels(count).map((label) => ({ label })) }],
});
const multi = (count, options) => ({
  groups: [{ question: "Keep these in scope?", multiple: true, options: options ?? labels(count).map((label) => ({ label })) }],
});

// --- Rule 1: the single-select count ceiling ---

// Off-by-one is the whole rule: six is the measured legal maximum, seven is the
// shape that was actually wrong. A `>=` here would refuse a legal six.
assert.equal(askShapeRefusal(single(SINGLE_SELECT_MAX_OPTIONS)), null,
  "six single-select options are the legal maximum: refusing them would break the convention the ceiling was measured against");
const overCount = askShapeRefusal(single(SINGLE_SELECT_MAX_OPTIONS + 1));
assert.notEqual(overCount, null, "seven single-select options are refused: this is the 7-row radio from issue #384");
assert.match(overCount, /7/, "the refusal names the actual count, not just the limit, so the worker can see how far over it is");
assert.match(overCount, new RegExp(String(SINGLE_SELECT_MAX_OPTIONS)), "the refusal names the ceiling it exceeded");
assert.match(overCount, /--multiple/,
  "the refusal names the exit: a size refusal without the multi-select redirect is a deadlock with a good error message");
assert.match(askShapeRefusal(single(20)), /20/, "the rule scales past the prompt example instead of special-casing seven");

// The asymmetry is the point, and it is the half a lazy fix breaks: multi-select
// confirmations legitimately reach seven or more rows, so a count rule that
// forgot `multiple !== true` would refuse the most common scope confirm.
assert.equal(askShapeRefusal(multi(SINGLE_SELECT_MAX_OPTIONS + 1)), null,
  "a seven-row multi-select is NOT refused: applying the radio ceiling to checkboxes would break every scope confirm");
assert.equal(askShapeRefusal(multi(12)), null,
  "a twelve-row multi-select is NOT refused: the ceiling is single-select-only, not a global option cap");
// A missing `multiple` reads as single-select, exactly as the radio renderer does.
assert.notEqual(askShapeRefusal({ groups: [{ question: "Which?", options: labels(7).map((label) => ({ label })) }] }), null,
  "an absent `multiple` is single-select, so it is still refused: treating undefined as multi would hide the bug behind a default");

// --- Rule 2: the recommendation marker ---

const marked = (label) => ({ label });
assert.equal(askShapeRefusal(single(3, [marked("A (Recommended)"), marked("B"), marked("C")])), null,
  "one recommendation on a single-select question is the correct shape and must pass");
assert.equal(askShapeRefusal(single(3, [marked("A"), marked("B"), marked("C")])), null,
  "zero recommendations pass: the marker is optional, not mandatory");
// Multi-select may recommend several — the same asymmetry as the count rule.
assert.equal(askShapeRefusal(multi(4, [marked("A (Recommended)"), marked("B (Recommended)"), marked("C")])), null,
  "a multi-select may mark several recommendations: checkboxes compose, radios do not");

// --- Malformed input never throws ---

// The gate is called on parsed CLI input, so a bad shape must come back as a
// pass-through verdict (null) rather than a TypeError that aborts the ask path.
for (const groups of [[], null, undefined, "nope", 42, {}]) {
  assert.equal(askShapeRefusal({ groups }), null,
    `groups=${JSON.stringify(groups)} returns null, not a throw: unreadable input must never crash the ask handler`);
}
assert.equal(askShapeRefusal({ groups: [null, undefined, "x", 7] }), null,
  "non-object groups are skipped, not counted: they have no options to measure");
assert.equal(askShapeRefusal({ groups: [{ question: "Which?" }] }), null,
  "a missing options array reads as zero options, not as a crash");
assert.equal(askShapeRefusal({ groups: [{ question: "Which?", multiple: false, options: "A,B,C" }] }), null,
  "a non-array options value reads as zero options, not as a crash");
assert.equal(askShapeRefusal({ groups: [{ question: "Which?", options: [null, { label: 42 }, { label: null }] }] }), null,
  "non-string and missing labels do not throw: the marker test coerces before matching");
// Bare string options are read exactly like shaped ones — `optionLabel` handles
// both. A fix that only measured `{ label }` objects would let the count rule be
// bypassed by passing plain strings.
assert.notEqual(askShapeRefusal({ groups: [{ question: "Which?", options: labels(7) }] }), null,
  "seven BARE-string options are counted and refused: the count rule must not be bypassable by omitting the object wrapper");
assert.equal(askShapeRefusal({ groups: [{ question: "Which?", options: labels(6) }] }), null,
  "six bare-string options are the legal maximum, same as shaped ones");

// --- Wiring: the dispatcher must actually call the shape gate ---

// The lib can be perfect and still not be reached. This pins the one call site
// in `decideAskGate`, and the code-2 contract (a malformed ask is not retried).
const base = {
  liveCount: 0,
  expiredCount: 0,
  kind: "build",
  intent: "feature",
  stage: "shape",
  tag: "standard",
  forced: false,
};
const wired = decideAskGate({ ...base, groups: single(7).groups });
assert.equal(wired.allowed, false, "a 7-row radio is refused through the dispatcher, not just in the lib");
assert.equal(wired.code, 2, "the shape refusal is terminal (code 2), so the worker does not retry the same malformed ask");
assert.equal(decideAskGate({ ...base, groups: multi(7).groups }).allowed, true,
  "the same seven rows pass through the dispatcher as a multi-select: the asymmetry survives the wiring");
assert.equal(decideAskGate({ ...base, forced: true, groups: single(7).groups }).allowed, true,
  "--force bypasses the shape rule like the rest of the family");

// --- Rule 2's refusing half ---
//
// The spec says the marker is matched inside the label text, case-insensitively,
// so these assertions are the spec and were written against it before the code
// agreed. The first implementation wrote the parentheses escaped TWICE
// (/\\(Recommended\\)/i), which matches a pair of LITERAL BACKSLASHES rather
// than parentheses — so it matched no label this project ever produces (upstream
// emits "Shaping (Recommended)", see skills/stelow-workflow-shape-up) and the
// whole rule was unreachable while looking correct. These rows went red against
// that code and stay as its regression pin: re-adding the backslash turns them
// red again.
const twoMarks = askShapeRefusal(single(3, [marked("A (Recommended)"), marked("B (Recommended)"), marked("C")]));
assert.notEqual(twoMarks, null,
  "two markers on a single-select question are refused: while this returns null the whole "
  + "recommendation rule is unenforced and a reader is handed two 'Recommended' rows to rank themselves");
assert.match(twoMarks, /2/, "the refusal names how many options claimed the marker");
assert.match(askShapeRefusal(single(4, [marked("A (Recommended)"), marked("B (Recommended)"), marked("C (Recommended)"), marked("D")])), /3/,
  "three markers are also refused, with the count named");
// Case-insensitive, per the contract. A case-sensitive match would let
// "(recommended)" smuggle a second recommendation past the rule.
assert.notEqual(askShapeRefusal(single(2, [marked("A (Recommended)"), marked("B (recommended)")])), null,
  "the marker match is case-insensitive: a lowercase second marker must still be refused");
assert.notEqual(askShapeRefusal(single(2, [marked("A (RECOMMENDED)"), marked("B (Recommended)")])), null,
  "an uppercase marker still counts");
assert.notEqual(askShapeRefusal(single(2, [marked("(Recommended) A"), marked("(Recommended) B")])), null,
  "a leading marker position counts too: the marker is anywhere in the label, not only a suffix");
// The marker is the parenthesized token, not the bare word. A matcher loosened
// to a substring would refuse a legal one-recommendation question whose other
// label merely mentions recommending — the false-refusal direction of this rule.
assert.equal(askShapeRefusal(single(3, [marked("A (Recommended)"), marked("B — recommended reading"), marked("C")])), null,
  "a bare 'recommended' in prose is not the marker: matching the substring would refuse a question that recommends exactly one option");
assert.equal(askShapeRefusal(single(3, [marked("A (Recommended)"), marked("B recommendation"), marked("C")])), null,
  "a word merely derived from 'recommend' is not the marker either: the rule keys on the exact parenthesized token upstream writes");

console.log("ask shape test ok: single-select count ceiling, multi-select exemption, malformed input and the recommendation marker pinned");
