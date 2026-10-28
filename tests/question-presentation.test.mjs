import assert from "node:assert/strict";
import { PROSE_SUMMARY_LIMIT, splitProseSummary } from "../lib/question-prose.mjs";

// Short descriptions render inline, untouched — the collapse must never eat
// a decision that already fits at a glance.
const short = "Wait for the other thread to land, then retry.";
assert.deepEqual(
  splitProseSummary(short),
  { head: short, tail: null },
  "short descriptions pass through with nothing collapsed",
);

// A 4-option question at 150+ characters per description is a wall nobody
// reads before picking. The head stays visible, the rest is one click away,
// and head plus tail lose none of the original text.
const long = "Wait for the other thread to commit its work in progress. "
  + "I stop touching the shared checkout entirely and retry verify plus done "
  + "once their WIP lands or they fix the stale pin in the kanban layout test. "
  + "Safest of all: never touch another live thread's files. May take a while, "
  + "and I cannot tell when it lands.";
assert.ok(long.length > PROSE_SUMMARY_LIMIT, "the fixture really exceeds the preview limit");
const split = splitProseSummary(long);
assert.ok(split.tail !== null, "long descriptions collapse");
assert.ok(split.head.length < long.length && split.head.length > 0, "the head is a strict prefix view, not empty and not everything");
assert.ok(long.startsWith(split.head.slice(0, 40)), "the head comes from the description start, not invented text");
assert.ok(long.endsWith(split.tail.slice(-40)), "the tail reaches the description end — nothing is dropped");
// The old rule pinned `head >= limit / 2` against a degenerate stub. The
// first-sentence rule supersedes it, and the honest replacement says WHY:
// when the window contains a sentence end, the head is exactly that sentence
// (short first sentences are the writer's own cut, not a stub); when it does
// not, the substantial-head floor still applies to the word-boundary cut.
assert.equal(
  split.head,
  "Wait for the other thread to commit its work in progress.",
  "a first sentence inside the window is the head, whole — the writer's cut, not a stub that needs a length floor",
);
assert.ok(
  splitProseSummary("w ".repeat(400)).head.length >= PROSE_SUMMARY_LIMIT / 2,
  "with no sentence in the window the word-boundary head stays substantial, never a degenerate stub",
);
assert.deepEqual(
  splitProseSummary(null),
  { head: "", tail: null },
  "non-string descriptions degrade to empty instead of throwing",
);

// The rewrite changed the rule from "first 240 characters" to "first sentence
// when one fits", so the sentence preference is a behaviour worth naming: the
// reader gets the writer's own cut rather than half a condition.
{
  const twoSentences = "Be careful about the shared checkout. " + "x".repeat(200);
  const cut = splitProseSummary(twoSentences);
  assert.equal(cut.head, "Be careful about the shared checkout.", "a sentence that fits is returned whole and untruncated");
  assert.ok(cut.tail !== null, "the rest stays one click away");
  // Nothing but the boundary separator is dropped when the sentence is the cut
  // point: collapsing whitespace makes the two parts the whole passage.
  const flatten = (value) => value.replace(/\s+/g, " ").trim();
  assert.equal(flatten(cut.head + " " + cut.tail), flatten(twoSentences), "head plus tail is the whole passage");
}

// Past the sentence rule the word-boundary cut must still leave a door: an
// over-limit passage with no sentence terminator at all — one long token, or a
// wall of words — must never come back whole.
{
  const wall = splitProseSummary("w ".repeat(400));
  assert.ok(wall.tail !== null && wall.tail.length > 0, "a wall of words always has a tail behind the disclosure");
  const token = splitProseSummary("x".repeat(PROSE_SUMMARY_LIMIT + 10));
  assert.ok(token.tail !== null && token.tail.length > 0, "an unbreakable over-limit token still leaves a door");
  assert.ok(token.head.length <= PROSE_SUMMARY_LIMIT, "the hard cut never exceeds the limit it promises");
}

console.log("question presentation test ok: long prose collapses behind the first sentence without losing text");
