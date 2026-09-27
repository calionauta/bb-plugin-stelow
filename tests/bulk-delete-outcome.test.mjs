import assert from "node:assert/strict";
import { describeBulkDelete } from "../lib/bulk-delete-outcome.mjs";

/**
 * A bulk delete that reported only "done" would hide the one card whose native
 * run refused to stop, and the reader would look at an empty column and believe
 * it. The wording is the whole safety property of the action, so it is pinned
 * against the three ways it could lie: overstating the count, calling a
 * partial run a success, and dropping the reason.
 */

const fail = (cardId, error) => ({ cardId, error });

// The clean run: what the reader was promised happened.
{
  const out = describeBulkDelete({ deleted: ["a", "b", "c"], failed: [] }, 3);
  assert.equal(out.tone, "success", "every card gone is a success");
  assert.equal(out.message, "Deleted 3 archived cards.", "and it names how many");
}

// The partial run. This is the one that matters: it must NOT read as success,
// must not claim the requested count, and must keep the reason.
{
  const out = describeBulkDelete(
    { deleted: ["a", "b", "c"], failed: [fail("d", "The native workflow could not be stopped; the card was not deleted.")] },
    4,
  );
  assert.equal(out.tone, "error", "a card left behind is not a success, however many went");
  assert.match(out.message, /Deleted 3 of 4\./, "it states what went out of what was asked — never the request as the result");
  assert.match(out.message, /Still there: 1 —/, "and it says something is still there");
  assert.match(
    out.message,
    /native workflow could not be stopped/,
    "the reason survives, because one reason is actionable and hiding it sends the reader round again",
  );
}

// Nothing went: saying "Deleted 4" here would be the worst lie in the set.
{
  const out = describeBulkDelete(
    { deleted: [], failed: [fail("a", "Only archived cards can be deleted. Archive it first."), fail("b", "not archived")] },
    2,
  );
  assert.equal(out.tone, "error");
  assert.match(out.message, /^Deleted nothing\./, "it does not claim a deletion that never happened");
  assert.match(out.message, /\+1 more/, "and it counts the rest rather than printing a wall of repeats");
}

// One card: singular, so the sentence is not a template with a number in it.
assert.equal(
  describeBulkDelete({ deleted: ["a"], failed: [] }, 1).message,
  "Deleted 1 archived card.",
);

// A run that refused everything must still show the FIRST reason verbatim.
{
  const out = describeBulkDelete({ deleted: [], failed: [fail("a", "reason one"), fail("b", "reason two")] }, 2);
  assert.match(out.message, /reason one/, "the first reason is spelled out");
  assert.doesNotMatch(out.message, /reason two/, "the rest are counted — a repeated block buries the first");
}

// Malformed or missing results must not throw and must not read as success: an
// empty object is not evidence that anything was deleted.
for (const result of [null, undefined, {}, { deleted: null, failed: null }]) {
  const out = describeBulkDelete(result, 0);
  assert.equal(out.tone, "error", `a missing result is not a success: ${JSON.stringify(result)}`);
  assert.doesNotMatch(out.message, /Deleted \d+ archived/, "and it never claims a count it cannot support");
}

// A negative or zero request is not believed: the count falls back to what the
// server actually reported.
assert.equal(
  describeBulkDelete({ deleted: ["a", "b"], failed: [] }, 0).message,
  "Deleted 2 archived cards.",
  "a zero request does not turn two deletions into \"Deleted 0\"",
);

console.log("bulk delete outcome test ok: the report cannot overstate what was deleted");
