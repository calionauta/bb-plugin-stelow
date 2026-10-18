import assert from "node:assert/strict";
import { exclusivePickRefusal, pickedLabels } from "../lib/question-batch.mjs";

// A single-select question renders as a radio group, so it may hold ONE pick
// (issue #383) — but a pick composes with free text, so the answer list is
// legitimately longer than the pick count: ["A", "trim the scope"] is one pick
// plus a note. These two helpers are the server's half of that rule.
// `pickedLabels` separates declared labels from free text; `exclusivePickRefusal`
// refuses two PICKS and nothing else. A raw entry-count check would refuse the
// pick/note feature, and a whole-answer passthrough would let two mutually
// exclusive options reach the worker as two decisions — every assertion below
// fails for one of those two directions.

// --- pickedLabels: what counts as a pick ---

// Free text is not a pick.
assert.deepEqual(
  pickedLabels(["A", "trim the scope"], ["A", "B"]),
  ["A"],
  "a pick plus a note must read as ONE pick: returning both would make the single-select guard refuse the pick/note feature",
);

// Every declared label present is a pick, in answer order.
assert.deepEqual(
  pickedLabels(["A", "B"], ["A", "B"]),
  ["A", "B"],
  "two declared labels must both be counted: dropping one would let a radio group carry two picks",
);

// Free text alone yields no pick, so a note-only answer is legal.
assert.deepEqual(
  pickedLabels(["trim the scope", "and rename it"], ["A", "B"]),
  [],
  "notes-only must read as zero picks, otherwise a note alone would be refused as a multi-pick",
);

assert.deepEqual(pickedLabels([], ["A"]), [], "an empty answer list has no picks");
assert.deepEqual(pickedLabels(["A", "B"], []), [], "no declared labels means nothing can be a pick");
assert.deepEqual(
  pickedLabels(["A", 1, null, {}, ["A"]], ["A"]),
  ["A"],
  "non-string entries inside the answer list must be ignored, not counted",
);
assert.deepEqual(
  pickedLabels(["A", "B"], ["A", 1, null, "", ["A"], {}]),
  ["A"],
  "non-string and empty declared labels must be unusable, never matchable",
);

// Matching is exact: a near-miss label is free text, not a pick.
assert.deepEqual(
  pickedLabels(["A "], ["A"]),
  [],
  "matching must be exact — trimming or substring matching would turn typed text into a phantom pick",
);
assert.deepEqual(
  pickedLabels(["a"], ["A"]),
  [],
  "matching is case-sensitive: a lowercased lookalike is free text, so it must not raise the pick count",
);

// Unusable input returns [] instead of throwing, because the payload arrives
// from clients and stale bundles.
for (const answers of [null, undefined, "A", 42, {}, ["A"][0], [undefined, null, 42, {}]]) {
  assert.deepEqual(
    pickedLabels(answers, ["A"]),
    [],
    `malformed answers (${JSON.stringify(answers) ?? String(answers)}) must degrade to no picks, never throw`,
  );
}
for (const labels of [null, undefined, "A", 42, {}, [""], [0, null, {}]]) {
  assert.deepEqual(
    pickedLabels(["A", "B"], labels),
    [],
    `malformed optionLabels (${JSON.stringify(labels) ?? String(labels)}) must make every answer free text, never a pick`,
  );
}

// --- exclusivePickRefusal: the refusals ---

const twoPicks = exclusivePickRefusal({
  question: "Approve the plan?",
  multiple: false,
  answers: ["Approve", "Reject"],
  optionLabels: ["Approve", "Reject"],
});
assert.equal(
  typeof twoPicks,
  "string",
  "two declared picks on a single-select question must refuse: without this the worker receives both options as two decisions",
);
assert.match(
  twoPicks,
  /but 2 were submitted/,
  "the refusal must name how many picks it saw; 'at least two' would hide whether one or five labels arrived",
);
assert.match(
  twoPicks,
  /Approve, Reject/,
  "the refusal must name which labels were submitted, otherwise the human cannot tell which pick to drop",
);
assert.match(
  twoPicks,
  /Approve the plan\?/,
  "the refusal must name the question, otherwise a batched form cannot tell which of several questions was refused",
);
assert.match(
  twoPicks,
  /[Pp]ick one and submit again/,
  "the refusal must name the door back; a refused batch with no stated exit is a deadlock",
);

// The count is the real pick count, not a constant.
const threePicks = exclusivePickRefusal({
  multiple: false,
  answers: ["x", "A", "B", "C"],
  optionLabels: ["A", "B", "C"],
});
assert.match(
  threePicks,
  /but 3 were submitted/,
  "free text mixed into a three-pick answer must not change the reported pick count",
);

// --- a repeated label is one choice, not two ---

// The renderer can never emit a duplicate (`toggleSinglePick` returns a single
// label), so a repeated label is only reachable from a retried request or a
// client that failed to dedupe — and that must fail OPEN, because a reader who
// re-sent the same pick has made one decision, not two.
assert.deepEqual(
  pickedLabels(["A", "A"], ["A", "B"]),
  ["A"],
  "a label repeated in the answers is ONE pick: matching every occurrence would count a retried submit as two choices and dead-end the reader",
);
assert.equal(
  exclusivePickRefusal({ question: "Pick one", multiple: false, answers: ["A", "A"], optionLabels: ["A", "B"] }),
  null,
  "a single-select question answering the same label twice must be allowed, not refused as a two-pick submit",
);
assert.equal(
  exclusivePickRefusal({
    question: "Pick one",
    multiple: false,
    answers: ["A", "A", "trim the scope"],
    optionLabels: ["A", "B"],
  }),
  null,
  "a repeated pick plus a note is still one pick: dedupe must survive alongside free text",
);

// Dedupe must collapse repeats WITHOUT swallowing a second distinct label.
assert.deepEqual(
  pickedLabels(["A", "B", "A"], ["A", "B"]),
  ["A", "B"],
  "dedupe must not stop counting the second distinct label: a set that reset on repeat would let two mutually exclusive picks through",
);

// Two distinct picks still refuse, counted and named once each.
const repeated = exclusivePickRefusal({
  question: "Pick one",
  multiple: false,
  answers: ["A", "B", "A", "B"],
  optionLabels: ["A", "B"],
});
assert.equal(
  typeof repeated,
  "string",
  "two distinct picks must refuse even when each is repeated: dedupe must not be read as permission for a second option",
);
assert.match(
  repeated,
  /but 2 were submitted/,
  "the refusal must report the DISTINCT pick count: counting raw matches would say 4 and misdescribe one choice repeated twice",
);
assert.match(
  repeated,
  /\(A, B\)\./,
  "the refusal must name each submitted pick exactly once; double-counting would print (A, A, B, B) and hide which labels are in play",
);
assert.doesNotMatch(
  repeated,
  /A, A|B, B|3 were|4 were/,
  "a repeated label must never inflate the count or the label list in the message the human reads",
);

// --- exclusivePickRefusal: the allowed direction ---

// Multi-select may hold many picks.
assert.equal(
  exclusivePickRefusal({ question: "Pick any", multiple: true, answers: ["A", "B", "C"], optionLabels: ["A", "B", "C"] }),
  null,
  "a multi-select question holds many picks: refusing here breaks every checkbox question",
);

// Only an exact `true` counts as multi-select.
for (const multiple of ["true", "yes", 1, null, undefined, {}, []]) {
  assert.equal(
    typeof exclusivePickRefusal({ question: "Pick one", multiple, answers: ["A", "B"], optionLabels: ["A", "B"] }),
    "string",
    `multiple=${JSON.stringify(multiple) ?? String(multiple)} is not the literal true,`
      + " so it must not unlock a radio group: a truthy check would let a"
      + " malformed flag bypass the single-choice rule",
  );
}

// Zero or one pick on a single-select question passes.
assert.equal(
  exclusivePickRefusal({ question: "Pick one", multiple: false, answers: [], optionLabels: ["A", "B"] }),
  null,
  "a skipped question must pass: answering has to be optional",
);
assert.equal(
  exclusivePickRefusal({ question: "Pick one", multiple: false, answers: ["A"], optionLabels: ["A", "B"] }),
  null,
  "one pick on a radio group is exactly the allowed shape",
);

// THE composability case: a pick plus a note is ONE pick.
assert.equal(
  exclusivePickRefusal({
    question: "Pick one",
    multiple: false,
    answers: ["A", "trim the scope"],
    optionLabels: ["A", "B"],
  }),
  null,
  "pick-plus-note must be allowed: counting answer entries instead of declared labels would refuse the pick/note feature this rule exists to keep",
);
// Free text alongside two picks does not excuse them.
assert.equal(
  typeof exclusivePickRefusal({
    question: "Pick one",
    multiple: false,
    answers: ["A", "B", "trim the scope"],
    optionLabels: ["A", "B"],
  }),
  "string",
  "free text must not mask two real picks: if the guard stopped at the answer-list length it would let a second pick hide behind the note",
);

// A note alone is a valid answer.
assert.equal(
  exclusivePickRefusal({ question: "Pick one", multiple: false, answers: ["use your judgement"], optionLabels: ["A", "B"] }),
  null,
  "a note-only answer carries zero picks, so a radio group may carry it",
);

// Unreadable payloads fail OPEN: an empty label list makes every answer free
// text, and silencing a real answer is worse than letting a stray pick through.
for (const optionLabels of [[], null, undefined, "A", 42, {}, [1, null, ""]]) {
  assert.equal(
    exclusivePickRefusal({ question: "Pick one", multiple: false, answers: ["A", "B"], optionLabels }),
    null,
    `unreadable optionLabels (${JSON.stringify(optionLabels) ?? String(optionLabels)})`
      + " must refuse nothing: failing closed here would swallow an answer nobody can read",
  );
}
for (const answers of [null, undefined, 42, {}, "A"]) {
  assert.equal(
    exclusivePickRefusal({ question: "Pick one", multiple: false, answers, optionLabels: ["A", "B"] }),
    null,
    `malformed answers (${JSON.stringify(answers) ?? String(answers)}) must read as zero picks, never throw`,
  );
}

// An unnamed question still refuses, and still names the door back.
const unnamed = exclusivePickRefusal({ question: "   ", multiple: false, answers: ["A", "B"], optionLabels: ["A", "B"] });
assert.equal(typeof unnamed, "string", "a missing question title must not disable the guard");
assert.match(unnamed, /This question/, "an unnamed question falls back to a placeholder rather than printing empty quotes");
assert.match(unnamed, /submit again/, "even the unnamed refusal names the way out");

// An absent input object has no picks to count.
assert.equal(exclusivePickRefusal({}), null, "an empty input object carries no picks and must not throw");

console.log(
  "exclusive pick: ok (free text is not a pick, pick+note passes, two picks refused with count and exit, unreadable payloads fail open)",
);
