import assert from "node:assert/strict";
import test from "node:test";
import { boardWorkflowDefaultsSchema, workflowSchema } from "../server/contracts.ts";

// Retiring a stored key is a DATA question, and the answer must not be a
// per-key tombstone.
//
// The board defaults live in a kv row written by an older build; `state.md` and
// `stelow.json` hold the same shape for every card seeded earlier. Those rows
// carry keys this version no longer has. The old approach named each retired key
// as an optional field that meant nothing — legacy kept alive only to parse
// legacy, with a docstring explaining that the field was dead. Every retirement
// added another one, and the schema became a museum of knobs nobody could safely
// delete.
//
// The replacement rule is a property of the READER, not of the retired key: the
// persisted shapes tolerate unknown keys, so a row from any older build parses,
// its retired keys vanish, and the fields that still mean something survive.
// Nothing needs to know which keys used to exist, which is what makes the next
// retirement free instead of another tombstone.

test("a stored row carrying a retired key still parses, and keeps what matters", () => {
  const row = boardWorkflowDefaultsSchema.safeParse({
    quality: "production",
    supervisor: "high", // retired: a row written before the knob went away
    explorationCount: 3,
    reviewMode: "Product Spec + Interface + Scopes",
    reviewGates: ["spec", "interface", "scope"],
  });
  assert.equal(row.success, true, "an older row must never be rejected: a rejected kv row silently resets the operator's gates");
  assert.deepEqual(row.data.reviewGates, ["spec", "interface", "scope"], "the operator's review gates survive the read");
  assert.equal(
    "supervisor" in row.data,
    false,
    "the retired key is dropped, not carried along: keeping it would be the tombstone this rule removes",
  );
});

test("tolerance is generic, so the NEXT retirement needs no schema change", () => {
  // The point of the rule: a key that no build currently mentions — not
  // `supervisor`, just something from a future or a fork — must parse too.
  const row = boardWorkflowDefaultsSchema.safeParse({
    quality: "experimental",
    explorationCount: 2,
    reviewMode: "Auto",
    someKnobFromAnotherBranch: "whatever",
    anotherRetiredThing: [1, 2, 3],
  });
  assert.equal(row.success, true, "an unknown key cannot be refused, or every retirement becomes a migration");
  assert.deepEqual(Object.keys(row.data).sort(), ["explorationCount", "quality", "reviewGates", "reviewMode"].sort(),
    "only the keys this schema declares come out the other side");
});

test("tolerance did not make the schema lax: a malformed KNOWN value still fails", () => {
  // If this passes, the fallback has become "accept anything", which would let
  // a corrupt row through and lose the gates for real instead of merely
  // ignoring a dead key.
  const badQuality = boardWorkflowDefaultsSchema.safeParse({
    quality: "production-ish", explorationCount: 3, reviewMode: "Auto",
  });
  assert.equal(badQuality.success, false, "an out-of-vocabulary quality is still refused");

  const badCount = boardWorkflowDefaultsSchema.safeParse({
    quality: "production", explorationCount: 0, reviewMode: "Auto",
  });
  assert.equal(badCount.success, false, "an out-of-range exploration count is still refused");

  const missing = boardWorkflowDefaultsSchema.safeParse({ quality: "production" });
  assert.equal(missing.success, false, "a missing required key is still refused: tolerance is about UNKNOWN keys only");
});

test("a card row written by an older build parses into the current shape", () => {
  // The persisted card shape, not just the kv row: `state.md` from a card seeded
  // before the knob retired carries `supervisor:` in its config block.
  const card = workflowSchema.safeParse({
    id: "card_legacy",
    name: "Seeded before the knob retired",
    description: "",
    status: "in-progress",
    stage: "triage",
    quality: "production",
    supervisor: "high", // retired, present in the stored row
    explorationCount: 3,
    explorationHybrid: true,
    reviewMode: "Auto",
    reviewGates: [],
    dirHash: "abc123",
    phases: [],
    scopes: [],
    artifacts: [],
  });
  assert.equal(card.success, true, "an existing card must keep loading: this is the fallback that replaces per-key compat code");
  assert.equal("supervisor" in (card.data ?? {}), false, "and the retired value is not propagated into new writes");
});

test("the host advertises no retired key", () => {
  const keys = Object.keys(boardWorkflowDefaultsSchema.shape);
  assert.deepEqual(keys.sort(), ["appetite", "explorationCount", "quality", "redFirst", "reviewGates", "reviewMode"].sort(),
    "the advertised shape is exactly what the host reads: a key that is never emitted must not be declared");
  for (const retired of ["supervisor", "supervision", "supervisorMode"]) {
    assert.equal(keys.includes(retired), false, `${retired} is gone from the contract, not merely optional`);
  }
});
