import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptanceLine,
  acceptanceRefusal,
  acceptedDate,
  isAccepted,
  unmergedPrNumber,
} from "../lib/card-acceptance.mjs";

/**
 * Human acceptance is a receipt, never a gate.
 *
 * The proposal (§4.4) asked for a recorded human acceptance of a finished
 * result, and named the two failure modes explicitly: it must never block the
 * workflow, and it must not invent an authority the host does not have. Both
 * are tested here, because both are the kind of rule that reads fine in a
 * comment and is absent from the code.
 *
 * **Why the refusal is tested and not just the write.** A refusal that names no
 * exit is a deadlock with a good error message, so every refusal below asserts
 * the exit as well as the reason: a reader who cannot accept a card is told how
 * they could.
 *
 * **Why the timestamp-only shape is asserted at all.** It looks like an
 * omission. It is a decision: the host SDK exposes no operator identity
 * (`useRpc`, `bb.sdk.threads`, `bb.storage` — none of them answer "who is signed
 * in", and every `displayName` in the SDK belongs to a project or a preset). A
 * name field here would be free text wearing attribution's clothes. The test
 * pins the decision so it is a decision rather than a gap somebody later fills
 * with `os.userInfo()`.
 */

test("only a completed card can be accepted, and the refusal names the exit", () => {
  assert.equal(acceptanceRefusal({ status: "completed" }), null);

  // Not done yet: nothing finished exists to accept.
  const early = acceptanceRefusal({ status: "in-progress" });
  assert.ok(early, "an unfinished card is refused");
  assert.match(early, /Done/, "the refusal names the state that would allow it");

  // Draft and pending are the two other live statuses, and both are refused
  // for the same reason as in-progress.
  assert.ok(acceptanceRefusal({ status: "draft" }));
  assert.ok(acceptanceRefusal({ status: "pending" }));
});

test("an archived card is refused, and the refusal names restore as the exit", () => {
  const archived = acceptanceRefusal({ status: "archived" });
  assert.ok(archived);
  assert.match(archived, /restore/i, "the refusal names the way back");

  // The archived flag is what the lifecycle actually passes, and it has to
  // refuse on its own: a card can carry a live-looking status and still be
  // terminal by the flag.
  assert.ok(acceptanceRefusal({ status: "completed", archived: true }));
});

test("a missing stamp is not an acceptance, and never the epoch", () => {
  // Every falsy and non-numeric shape a row can hold. A zero stamp would
  // otherwise render as "accepted on 1970-01-01", which is a receipt the host
  // never wrote.
  for (const value of [null, undefined, 0, -1, NaN, "1700000000000", {}]) {
    assert.equal(isAccepted(value), false, `${String(value)} is not an acceptance`);
    assert.equal(acceptanceLine(value), null, `${String(value)} produces no line`);
    assert.equal(acceptedDate(value), "", `${String(value)} produces no date`);
  }
  assert.equal(isAccepted(1_700_000_000_000), true);
});

test("the disposition line says what the receipt holds and nothing more", () => {
  const at = Date.UTC(2026, 9, 2, 12, 0, 0);
  const line = acceptanceLine(at);
  assert.ok(line);
  assert.match(line, /Accepted by you/);
  assert.match(line, /2026-10-02/, "the date is in the line");
  // The claim it must NOT make. Done certifies verification, not shipping, and
  // a receipt that implied merge/deploy would be a second, false source of
  // truth about what happened to the work.
  for (const word of ["merged", "deployed", "shipped", "released"]) {
    assert.doesNotMatch(line, new RegExp(word, "i"), `the line does not claim ${word}`);
  }
});

test("the same stamp renders the same line, so no surface can phrase it differently", () => {
  const at = Date.UTC(2026, 0, 15, 0, 0, 0);
  assert.equal(acceptanceLine(at), acceptanceLine(at));
  assert.equal(acceptedDate(at), "2026-01-15");
});

test("the cross-reference names only a still-open pull request", () => {
  // A Done card can carry both a receipt and an unmerged PR with nothing
  // linking them — approving then reads as finishing. Merged, closed, absent
  // and unreadable all read as null: the note is advisory, so a missing
  // sentence is a missing sentence, never an error on the receipt.
  assert.equal(unmergedPrNumber({ pullRequest: { number: 322, state: "open" } }), 322, "an open PR is named");
  assert.equal(unmergedPrNumber({ pullRequest: { number: 322, state: "draft" } }), 322, "a draft still needs merging");
  assert.equal(unmergedPrNumber({ pullRequest: { number: 322, state: "merged" } }), null, "merged needs no cross-reference");
  assert.equal(unmergedPrNumber({ pullRequest: { number: 322, state: "closed" } }), null, "closed needs none either");
  assert.equal(unmergedPrNumber({ pullRequest: null }), null, "no PR means no note");
  assert.equal(unmergedPrNumber(null), null, "an unreadable snapshot reads as no note, never a throw");
  assert.equal(unmergedPrNumber({ pullRequest: { number: "322", state: "open" } }), null, "a non-numeric number is not rendered");
});

// Wiring: the row reads the publication snapshot instead of re-deriving PR
// state, and only while the button is still offered — after acceptance the
// row is a stamp, and a fetch per render of a settled row would be a request
// nobody asked for.
const rowSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/detail/acceptance-row.tsx"),
  "utf8",
);
assert.match(rowSource, /rpc\.call\("publicationStatus", \{ cardId \}\)/, "the cross-reference asks the snapshot that owns PR state");
assert.match(
  rowSource,
  /useUnmergedPrNumber\(cardId, status === "completed" && !acceptanceLine\)/,
  "the snapshot is read only while the receipt can still be written",
);
