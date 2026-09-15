import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
const conflicting = splitOutcome(slices, ["Desktop layout", SPLIT_KEEP_LABEL]);
assert.equal(conflicting.action, "refuse", "keep is an exclusive alternative, never a hidden veto alongside slices");
assert.match(conflicting.reason, /either delivery cards or/, "the conflict tells the worker how to re-ask clearly");
const unknown = splitOutcome(slices, ["Desktop layout", "Free text idea"]);
assert.equal(unknown.action, "refuse", "custom text never becomes a card by accident");
assert.match(unknown.reason, /Free text idea/, "the refusal names the stranger");

const partial = splitRemainder(slices, [slices[0]]);
assert.equal(partial.archiveParent, false, "a remainder keeps the parent alive");
assert.deepEqual(partial.remaining.map((s) => s.title), ["Desktop layout", "Sound toggle"], "the remainder is exactly the unpicked");
const total = splitRemainder(slices, slices);
assert.equal(total.archiveParent, true, "full approval archives the parent");

// Point-of-use guard: a STANDARD ask answered at triage/select executes
// nothing, so the host reminds the worker once — while re-asking with the
// tag is still legal — instead of letting a would-be split die silently.
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.ts"), "utf8");
assert.match(serverSource, /recorded as STANDARD — its answer is text only and executes nothing/, "the ask result names the standard consequence");
assert.match(serverSource, /re-ask it now with --tag split --multiple/, "the reminder gives the exact repair while still in time");
assert.match(serverSource, /askCard\.stage === "triage" \|\| askCard\.stage === "select"/, "the reminder fires only where a split is still legal");

// The protocol forbids hedging: a grouping is either proposed with the tag
// or kept as one card — a validating standard question is never a middle.
assert.match(serverSource, /Never hedge with a standard question/, "the spawn prompt names hedging as the failure mode");

// Human trigger: one button drives the worker into the protocol. Guards
// mirror the worker split path so the UI can never promise what `split`
// would refuse; the nudge text lives once, next to SPLIT_PROTOCOL.
assert.match(serverSource, /const SPLIT_REQUEST_NUDGE = "Split requested/, "the request nudge is a single-source const");
assert.match(serverSource, /requestSplitProposal: \{/, "the RPC contract names the trigger");
assert.match(serverSource, /async requestSplitProposal\(\{ cardId \}\)/, "the handler resolves the card");
assert.match(serverSource, /card\.stage !== "triage" && card\.stage !== "select"/, "the trigger refuses past the split point like the worker path");
assert.match(serverSource, /A split proposal is already open on this card/, "the trigger refuses while a proposal awaits an answer");
assert.match(serverSource, /SPLIT_REQUEST_NUDGE, mentions: \[\]/, "the trigger delivers the shared nudge to the worker thread");

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app.tsx"), "utf8");
assert.match(appSource, /Propose split…/, "the build card offers the trigger at triage/select");
assert.match(appSource, /rpc\.call\("requestSplitProposal", \{ cardId \}\)/, "the button calls the trigger RPC");

console.log("split proposal test ok: validation, keep veto, unknown refusal, partial remainder");
