import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TRACKABLE_STATUSES,
  TRACKABLE_STATUS_LABELS,
  trackableStatusLabel,
} from "../lib/trackables.mjs";
import {
  BLOCKING_RUN_STATUS,
  RUN_STATUSES,
  RUN_STATUS_LABELS,
  runStatusLabel,
} from "../lib/execution-run-ledger.mjs";
import { statusGlyph, statusTone } from "../lib/detail-presentation.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";

/**
 * The naming halves, asserted as behaviour rather than as declarations.
 *
 * An earlier commit on this branch moved these names out of components and into
 * the modules that own the values, and claimed they were mutation-checked. They
 * were not: `TRACKABLE_STATUS_LABELS`, `RUN_STATUS_LABELS`, `runStatusLabel`,
 * `trackableStatusLabel` and `statusGlyph` had **zero** behavioural assertions, so
 * every one of them could be deleted or made to return the raw enum and the suite
 * would still pass. An adversarial pass found that, by mutating all five and
 * watching nothing fail.
 *
 * The claim that `RUN_STATUSES` "matches the CHECK constraint" was also false as
 * tested. The real check is below: it parses the constraint out of the SQL and
 * compares, because a hand-maintained list of values that a SQL constraint also
 * names is exactly the kind of pair that drifts while both halves stay green.
 */

const root = new URL("..", import.meta.url).pathname;

test("RUN_STATUSES is exactly what the SQL CHECK admits", () => {
  // Parsed from the schema, not restated. If someone adds a status to the CHECK
  // and forgets the list — or the reverse — this fails and says which side moved.
  const ledger = readFileSync(join(root, "lib/execution-run-ledger.mjs"), "utf8");
  const match = ledger.match(
    /normalized_status TEXT NOT NULL CHECK \(normalized_status IN \(([^)]*)\)\)/,
  );
  assert.ok(match, "the normalized_status CHECK constraint is still present and readable");

  const fromSql = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...RUN_STATUSES],
    fromSql,
    "RUN_STATUSES and the column's CHECK constraint name the same statuses, in the same order",
  );
  assert.deepEqual(
    Object.keys(RUN_STATUS_LABELS),
    fromSql,
    "and every one the constraint admits has a name",
  );
});

test("a trackable's name is a word, and it covers every status", () => {
  for (const status of TRACKABLE_STATUSES) {
    assert.equal(
      trackableStatusLabel(status),
      TRACKABLE_STATUS_LABELS[status],
      `${status} resolves to its own name`,
    );
    assert.notEqual(
      TRACKABLE_STATUS_LABELS[status],
      status,
      `${status} would be shown to readers as its own stored value`,
    );
  }
  // The names must be distinct: two trackables called "Done" is a list that
  // cannot say which one it is.
  const names = Object.values(TRACKABLE_STATUS_LABELS);
  assert.equal(new Set(names).size, names.length, "no two trackable statuses share a name");
});

test("an unknown status falls back to itself in every axis, never to nothing", () => {
  // A card can carry a trackable, a run or a status this build has never heard of
  // — synced from a newer plugin, or written by a future version. Returning ""
  // renders a blank pill and loses the fact; returning the raw value keeps it
  // readable. Pinned so "just return null when unknown" cannot look like tidying.
  assert.equal(trackableStatusLabel("status_from_the_future"), "status_from_the_future");
  assert.equal(runStatusLabel("status_from_the_future"), "status_from_the_future");
  assert.equal(trackableStatusLabel(""), "");
  assert.equal(runStatusLabel(""), "");
  assert.equal(trackableStatusLabel(undefined), "");
  assert.equal(runStatusLabel(undefined), "");
});

test("a run's name is a word, and needs_input is the one that earns its place", () => {
  // Every fixture in the retry suite uses `running` and `succeeded`, which are
  // spelled identically in the label map — so returning the raw enum passed all
  // of them. `needs_input` is the only run status whose LABEL differs from its
  // VALUE, and it is the one that matters most: it is the state where a person is
  // being asked something, and `needs_input` is not a phrase anyone reads.
  assert.equal(runStatusLabel("needs_input"), "Needs input");
  assert.notEqual(runStatusLabel("needs_input"), "needs_input");
  for (const status of RUN_STATUSES) {
    assert.ok(RUN_STATUS_LABELS[status], `${status} has a name`);
  }
});

test("the blocking run status is a real run status", () => {
  // `BLOCKING_RUN_STATUS` is the constant the failed-run gate keys on, and it was
  // exported from the ledger but absent from its type declarations. A constant
  // that names the status holding a card, with no declared type, is how the gate
  // and the ledger drift apart.
  assert.equal(BLOCKING_RUN_STATUS, "failed");
  assert.ok(RUN_STATUSES.includes(BLOCKING_RUN_STATUS), "and the ledger admits it");
  assert.equal(runStatusLabel(BLOCKING_RUN_STATUS), "Failed");
});

test("a finished status reads as finished by shape, not only by colour", () => {
  // Tone and glyph are the axis-agnostic half: they answer for a card's status
  // AND a scope's, because colour is the one fact a reader learns once. Shape is
  // the second channel, so a status that reads "done" by colour also has to read
  // as done in high contrast and to someone who cannot see colour at all.
  //
  // Pinned by STATUS, not by a regex over a component — a pin on a prop name
  // passes whether or not the function does anything.
  assert.equal(statusGlyph("done"), "✓");
  assert.equal(statusGlyph("completed"), "✓");
  assert.equal(statusGlyph("skipped"), "↷");
  assert.equal(statusGlyph("escalated"), "↑", "a stop someone must resolve, not a failure that happened");
  assert.equal(statusGlyph("failed"), "✗");
  assert.equal(statusGlyph("blocked"), "⚠");
  assert.equal(statusGlyph("in-progress"), "●");
  assert.equal(statusGlyph("archived"), "○");
  assert.equal(statusGlyph("something-unknown"), "·");
  // `approved` is a scope MAP status — neither a card nor a trackable status —
  // so it must read as unknown, not as in-progress. Both branches below used to
  // mention it, which read as though a card could be approved.
  assert.equal(statusGlyph("approved"), "·", "a map status is unknown to the trackable glyph");
  assert.equal(statusTone("approved"), statusTone("something-unknown"), "and to the tone");
});

test("the glyph agrees with the machine about what is finished", () => {
  // `statusGlyph` lives in a presentation module, so nothing made it agree with
  // `isDoneStatus` from the machine. If they drift, a "done" scope stops looking
  // done — derived from the shared predicate rather than restated, because a
  // restatement is the third copy.
  for (const status of [...TRACKABLE_STATUSES, "unknown"]) {
    const looksDone = statusGlyph(status) === "✓";
    assert.equal(
      looksDone,
      isDoneStatus(status),
      `${status}: the glyph says done=${looksDone}, the machine says ${isDoneStatus(status)}`,
    );
  }
});

test("a finished status also reads as finished by tone", () => {
  assert.equal(statusTone("done"), statusTone("completed"));
  assert.notEqual(statusTone("done"), statusTone("failed"));
  assert.notEqual(statusTone("done"), statusTone("in-progress"));
});
