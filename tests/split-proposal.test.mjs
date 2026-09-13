import assert from "node:assert/strict";
import { MAX_SPLIT_CHILDREN, MIN_SPLIT_CHILDREN, SPLIT_KEEP_LABEL, SPLIT_PROPOSAL_TTL_MS, splitOutcome, splitRemainder, validateSplitSlices } from "../lib/split-proposal.mjs";

// Regression: triage in a single-card flow cannot split — one card is one
// workflow by rule. The split path below is the only exit: a recorded,
// human-approved proposal, executed by the host, never by worker claim.

assert.equal(typeof SPLIT_KEEP_LABEL, "string", "the keep option is a literal the host matches");
assert.ok(MIN_SPLIT_CHILDREN >= 2, "fewer than two is scopes, not a split");
assert.ok(MAX_SPLIT_CHILDREN <= 6, "the cap stays reviewable in one ask");
assert.equal(SPLIT_PROPOSAL_TTL_MS, 24 * 60 * 60 * 1000, "a stale approval cannot split tomorrow's card");

const slices = [
  { title: "Unread filter", desc: "Filter chips for unread inbox items." },
  { title: "Desktop layout", desc: "Two-pane inbox layout for wide screens." },
  { title: "Sound toggle", desc: "Mute switch for notification sounds." },
];
assert.equal(validateSplitSlices(slices), null, "three titled, described slices validate");
assert.match(validateSplitSlices([{ title: "Only", desc: "one slice" }]), /at least 2/, "one slice is not a split");
assert.match(
  validateSplitSlices(Array.from({ length: MAX_SPLIT_CHILDREN + 1 }, (_, i) => ({ title: `S${i}`, desc: "x" }))),
  /at most 5/,
  "the cap refuses with its number",
);
assert.match(validateSplitSlices([{ title: "Has desc", desc: "scoped" }, { title: "No desc", desc: "  " }]), /needs a scope description/, "a title without scope is not a proposal");
assert.match(
  validateSplitSlices([{ title: "Dup", desc: "a" }, { title: "dup ", desc: "b" }]),
  /duplicated/,
  "titles match case-insensitively with trim",
);

const full = splitOutcome(slices, ["Unread filter", "Desktop layout", "Sound toggle"]);
assert.equal(full.action, "split", "all approved slices create");
assert.equal(full.approved.length, 3, "nothing is dropped silently");
assert.equal(splitOutcome(slices, []).action, "refuse", "an empty answer splits nothing");
assert.equal(splitOutcome(slices, [SPLIT_KEEP_LABEL]).action, "keep", "keep is honored");
assert.equal(splitOutcome(slices, ["Desktop layout", SPLIT_KEEP_LABEL]).action, "keep", "keep vetoes even alongside slices");
const unknown = splitOutcome(slices, ["Desktop layout", "Free text idea"]);
assert.equal(unknown.action, "refuse", "custom text never becomes a card by accident");
assert.match(unknown.reason, /Free text idea/, "the refusal names the stranger");

const partial = splitRemainder(slices, [slices[0]]);
assert.equal(partial.archiveParent, false, "a remainder keeps the parent alive");
assert.deepEqual(partial.remaining.map((s) => s.title), ["Desktop layout", "Sound toggle"], "the remainder is exactly the unpicked");
const total = splitRemainder(slices, slices);
assert.equal(total.archiveParent, true, "full approval archives the parent");

console.log("split proposal test ok: validation, keep veto, unknown refusal, partial remainder");
