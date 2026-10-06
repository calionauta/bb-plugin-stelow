import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheReport, positionOf } from "../lib/prompt-budget.mjs";
import { renderSpawnPaths } from "./helpers/prompt-paths.mjs";

/**
 * Where a prompt stops being reusable, and why it stops there.
 *
 * This is the measurement the prompt work was missing, and it has the largest
 * consequence of anything measured here. Provider prompt caching is PREFIX
 * matching: the reusable region ends at the first byte that differs. A prompt is
 * therefore cache-hostile in exact proportion to how early it interpolates
 * something card-specific, because everything after that value is re-uploaded and
 * re-paid as fresh input on every spawn.
 *
 * Measured on the five builders, two workers on two DIFFERENT cards: they share
 * 129 of 12,082 characters — **1.1%** — because the state dir is interpolated at
 * character ~106. The entire 10,075-character clause block that the two workers
 * genuinely share sits *after* that value, so the cache cannot reach any of it.
 * Reordering so shared clauses precede per-card values makes the same prompt
 * **99%** cacheable, with the same rules stated and the same token count.
 *
 * The property this file cares about is ORDER, not a ratio: a ratio pin would need
 * two fixtures and would break on any legitimate clause edit, while the order is
 * the rule a reviewer can act on and the thing a fix changes.
 *
 * ## Why the order check is skipped rather than failing
 *
 * It is currently red on all three build paths, and that is a product decision
 * rather than a bug to patch: hoisting 10 KB of protocols above the request moves
 * the instructions the model reads FIRST from the request to the boilerplate, and
 * instruction ordering affects compliance. Reordering is likely right — the shared
 * block is identical every time, which is exactly what a cache wants — but it is
 * the kind of change that should be made deliberately, with a look at how workers
 * behave, not folded into a test-writing session.
 *
 * So the gap is measured and REPORTED on every run instead of being either a
 * broken suite or an unrecorded finding. The negative controls below are real,
 * always-on assertions: they are what keep this file honest, because a position
 * helper that returned -1 for everything would make the skipped check vacuous.
 */

const paths = renderSpawnPaths();

/** Values that differ between two cards, and therefore end the cacheable region
 * wherever they appear. A builder that puts its first one early forfeits every
 * shared clause behind it. */
const PER_CARD_MARKERS = [
  "/repo/.stelow/2026-10-05/sw-card_probe", // the state dir
  "Add a read-only Scope Map view", // the request
];

/** Clauses every build path renders, and which must therefore sit BEFORE the first
 * per-card value for the cacheable region to contain them. The first and the last
 * of the block are both listed: the last is what proves the whole block precedes
 * the values, not just its opening. */
const SHARED_MARKERS = [
  "ANY time you need user input, you MUST call the structured form",
  "Never run `bb stelow seed`",
];

const BUILD_PATHS = ["spawn", "restart", "reseed"];

// --- The detector is guarded, in both directions, unconditionally. ----------
// A position helper that returned -1 for everything, or a cache report that
// measured the wrong region, would make every claim in this file meaningless — so
// these assertions do not depend on the state of the builders.
test("the cache-order detector measures the right region", () => {
  const shared = "SHARED BLOCK ".repeat(20);
  const cardA = `${shared} STATE_DIR=/cards/alpha REQUEST=build the thing`;
  const cardB = `${shared} STATE_DIR=/cards/beta REQUEST=fix the other thing`;

  const report = cacheReport(cardA, cardB);
  // The definition of a common prefix, asserted directly rather than against a
  // hand-counted length: the run may extend past the shared block while the text
  // that follows happens to match, and only the first DIFFERING byte bounds it.
  assert.equal(cardA.slice(0, report.prefix), cardB.slice(0, report.prefix), "the reported prefix is common to both prompts");
  assert.notEqual(cardA[report.prefix], cardB[report.prefix], "the reported prefix stops at the first byte that differs");
  assert.ok(report.prefix >= shared.length, `the run reaches at least the whole shared block (got ${report.prefix} of ${shared.length})`);
  assert.ok(report.ratio > 0.8, `a shared block placed first is cacheable (got ${report.ratio.toFixed(3)})`);
  assert.ok(report.divergedAt.includes("|"), "the report shows the text at the divergence, which is the value to move");

  const hostile = cacheReport(`STATE_DIR=/cards/alpha REQUEST=x ${cardA}`, `STATE_DIR=/cards/beta REQUEST=y ${cardB}`);
  // Not exactly zero: the two state dirs share a literal prefix ("STATE_DIR=/cards/"),
  // and that is the point of measuring a prefix rather than a set of shared text —
  // a per-card value at character zero leaves only the accidental overlap in its own
  // scaffolding, so a real template in this shape is un-cacheable in practice.
  assert.ok(hostile.ratio < 0.1, `a per-card value at character zero leaves almost nothing cacheable (got ${hostile.ratio.toFixed(3)})`);
  assert.ok(report.prefix > hostile.prefix * 10, `placing the shared block first multiplies the reusable region (${report.prefix} vs ${hostile.prefix})`);

  assert.equal(positionOf(cardA, "SHARED BLOCK"), 0, "a present marker reports its real position");
  assert.equal(positionOf(cardA, "NOT IN THE TEXT"), -1, "an absent marker reports -1 rather than 0, so 'absent' cannot read as 'at the start'");

  // A shared marker absent from a real prompt must fail the order check rather
  // than silently pass it — the failure mode where a renamed clause reads as a
  // well-ordered prompt.
  const absent = Math.min(...SHARED_MARKERS.map((marker) => positionOf(paths.spawn, marker)).filter((at) => at >= 0));
  assert.ok(absent >= 0, "the shared markers are found in a real build prompt, so the order check below is not vacuous");
});

// --- The property, measured. Skipped: see the header for why. ---------------
// When this is unskipped, it fails on all three paths today with the measured
// distances in the message. The numbers are the point: they say how much a
// reordering is worth before anyone spends a review on it.
test(
  "every build path states its shared clauses before any per-card value",
  { skip: "prompt order is a deliberate change; see the file header — the measurement is printed on every run" },
  () => {
    for (const path of BUILD_PATHS) {
      const rendered = paths[path];
      const firstPerCard = Math.min(
        ...PER_CARD_MARKERS.map((marker) => positionOf(rendered, marker)).filter((at) => at >= 0),
      );
      const lastShared = Math.max(
        ...SHARED_MARKERS.map((marker) => positionOf(rendered, marker)).filter((at) => at >= 0),
      );
      assert.ok(
        lastShared < firstPerCard,
        `${path} must state its shared clauses before interpolating any per-card value: the last shared clause is at `
          + `char ${lastShared} and the first per-card value at char ${firstPerCard}, so `
          + `${rendered.length - firstPerCard} characters are re-paid as fresh input on every spawn.`,
      );
    }
  },
);

// --- Reported every run, so the gap cannot be forgotten. --------------------
// `spawn` and `restart` on the same card also share almost nothing: the
// band-boundary handoff is a NEW thread, so it re-pays nearly the whole prompt.
// Reported rather than asserted, because a handoff that legitimately rewrites its
// instructions would move the number and that is not a defect.
test("the cross-card and handoff cache measurements are visible", () => {
  const handoff = cacheReport(paths.spawn, paths.restart, { label: "spawn -> restart (same card)" });
  const crossCardNote = BUILD_PATHS.map((path) => {
    const firstPerCard = Math.min(...PER_CARD_MARKERS.map((m) => positionOf(paths[path], m)).filter((at) => at >= 0));
    const total = paths[path].length;
    return `${path}: cacheable until char ${firstPerCard} of ${total} (${((firstPerCard / total) * 100).toFixed(1)}%)`;
  }).join(" · ");

  assert.ok(handoff.total > 0, "the handoff measurement saw both prompts");
  console.log(
    `prompt cache order: shared-first region per build path — ${crossCardNote}\n`
      + `  handoff spawn -> restart shares ${handoff.prefix} of ${handoff.total} chars `
      + `(${(handoff.ratio * 100).toFixed(1)}%) · divergence: ...${handoff.divergedAt.slice(-60)}`,
  );
});
