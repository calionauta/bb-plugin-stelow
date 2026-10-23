import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheReport, estimateTokens, positionOf } from "../lib/prompt-budget.mjs";
import { renderSpawnPairs, renderSpawnPaths } from "./helpers/prompt-paths.mjs";

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
 * Measured on the five builders, two workers on two DIFFERENT cards, before this
 * session's work:
 *
 *   build spawn 91.6% · research 7.2% · explore 9.6%
 *
 * The build paths were reordered first (F2), which is why their number is high.
 * The tracks were not: their first interpolation was the strategy (research) and
 * the stage (explore) in the opening sentence of Step 1 — 823 and 824 characters
 * in — so the entire shared contract sat behind a per-card value and two cards on
 * different tracks shared less than a tenth of their prompt. Reordering the steps
 * to name `<strategy>` / `<stage>` and moving every value into one card-values
 * block at the end makes the same prompts 93.0% / 91.8% reusable, with the same
 * rules stated.
 *
 * The property this file cares about is ORDER, not a ratio: a ratio pin would need
 * two fixtures and would break on any legitimate clause edit, while the order is
 * the rule a reviewer can act on and the thing a fix changes. The floors below are
 * a coarse net under the order check — they catch the class of regression
 * (a per-card value back in the shared prefix) without pinning a number that
 * drifts every time a clause is reworded.
 *
 * ## Why the order check is skipped rather than failing (build paths only)
 *
 * It was red on all three build paths when this file was written, and that was a
 * product decision rather than a bug to patch: hoisting 10 KB of protocols above
 * the request moves the instructions the model reads FIRST from the request to the
 * boilerplate, and instruction ordering affects compliance. F2 then measured the
 * trade and made the change, so the skip is gone. The history stays in this
 * header because the next person to consider hoisting more text should know it was
 * a decision with a cost rather than an oversight.
 *
 * The negative controls below are real, always-on assertions: they are what keep
 * this file honest, because a position helper that returned -1 for everything
 * would make the order check vacuous.
 */

const paths = renderSpawnPaths();
const pairs = renderSpawnPairs();

/** Values that differ between two cards, and therefore end the cacheable region
 * wherever they appear. A builder that puts its first one early forfeits every
 * shared clause behind it. */
const PER_CARD_MARKERS = [
  "/repo/.stelow/2026-10-05/sw-card_probe", // the state dir
  "Add a read-only Scope Map view", // the request
];

/** The FIRST shared marker on every path: the ask contract every worker owes.
 * Present on all five, so an order check built on it cannot pass because a path
 * simply does not render it. */
const FIRST_SHARED_MARKER = "ANY time you need user input, you MUST call the structured form";

/** The LAST shared marker per path — the clause that closes the shared region.
 * Build paths close on the split protocol; tracks close on the protocol footer
 * (completion, optional review, cheap drafts). Checking the last clause, not just
 * the first, is what proves the WHOLE block precedes the values: a reorder that
 * moved the footer below the card values would leave the first marker correct and
 * silently halve the prefix. */
const LAST_SHARED_MARKER = {
  spawn: "Split is exceptional, not a checklist decomposition",
  restart: "Split is exceptional, not a checklist decomposition",
  reseed: "Split is exceptional, not a checklist decomposition",
  research: "Cheap drafts: for disposable prose bursts",
  explore: "Cheap drafts: for disposable prose bursts",
};

const BUILD_PATHS = ["spawn", "restart", "reseed"];
const TRACK_PATHS = ["research", "explore"];
const ALL_PATHS = [...BUILD_PATHS, ...TRACK_PATHS];

/** The share of a build prompt two DIFFERENT cards share, which is what a provider
 * can serve from cache across threads. Measured 0.6% before F2 reordered the three
 * paths and 91-96% after; the floor sits well under the achieved value so a
 * legitimate clause edit does not fail it, while a per-card value moving back into
 * the prefix does. */
const BUILD_CACHE_FLOOR = 0.85;

/** The tracks' floor. Lower than the build one on purpose: a track prompt is a
 * single one-shot contract with no stage machinery behind it, so it has less
 * shared prose to hoist, and 75% is the bar this work was asked to clear. Measured
 * 93.0% (research) and 91.8% (explore); a regression to the old order lands at
 * 7-10% and fails here loudly. */
const TRACK_CACHE_FLOOR = 0.75;

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
  for (const path of ALL_PATHS) {
    assert.ok(positionOf(paths[path], FIRST_SHARED_MARKER) >= 0, `${path} renders the first shared marker, so the order check below is not vacuous`);
    assert.ok(positionOf(paths[path], LAST_SHARED_MARKER[path]) >= 0, `${path} renders the clause that closes its shared region`);
    for (const marker of PER_CARD_MARKERS) {
      assert.ok(positionOf(paths[path], marker) >= 0, `${path} renders the per-card marker ${marker}, so the "before" check has a value to compare against`);
    }
  }
});

// --- The property, measured on all five paths. -----------------------------
test("every spawn path states its shared clauses before any per-card value", () => {
  for (const path of ALL_PATHS) {
    const rendered = paths[path];
    const firstPerCard = Math.min(
      ...PER_CARD_MARKERS.map((marker) => positionOf(rendered, marker)).filter((at) => at >= 0),
    );
    const lastShared = Math.max(
      positionOf(rendered, FIRST_SHARED_MARKER),
      positionOf(rendered, LAST_SHARED_MARKER[path]),
    );
    assert.ok(
      lastShared < firstPerCard,
      `${path} must state its shared clauses before interpolating any per-card value: the last shared clause is at `
        + `char ${lastShared} and the first per-card value at char ${firstPerCard}, so `
        + `${rendered.length - firstPerCard} characters are re-paid as fresh input on every spawn.`,
    );
  }
});

// --- The tracks do not carry the BUILD completion payload. -----------------
// The other half of this session's change: `doneProtocol` was 2,479 characters,
// ~2,300 of them the build path (the `audit` stage, the rework loop, `audit.md`,
// the run bundle), and a research worker read all of it on every spawn while the
// rule it owed sat in the middle. This is the behavioural half of the fix, and it
// is asserted here as well as in `prompt-budget`, because a reorder that quietly
// reinstated the build clause would restore the cache regression too.
test("a track prompt states the track completion rule and not the build one", () => {
  for (const path of TRACK_PATHS) {
    const rendered = paths[path];
    assert.match(
      rendered,
      /Research\/explore cards complete only after `bb stelow verify` passes/,
      `${path} tells its worker what actually finishes the card`,
    );
    assert.doesNotMatch(
      rendered,
      /Before Build `done`|`bb stelow verify --tests`|gap-scopes/,
      `${path} must not send its worker into the build completion path`,
    );
  }
});

// --- The cross-card floors, asserted rather than printed. -------------------
// The measurement above is the reason this file exists, and a printed number
// nobody reads is how it regressed the first time. Each path is measured against
// its OWN second card, so the number is the real cross-card prefix rather than a
// pair chosen because it happens to be close.
test("two different cards share most of the same path's prompt", () => {
  const measured = {};
  for (const path of ALL_PATHS) {
    const [a, b] = pairs[path];
    const report = cacheReport(a, b);
    const floor = TRACK_PATHS.includes(path) ? TRACK_CACHE_FLOOR : BUILD_CACHE_FLOOR;
    measured[path] = `${(report.ratio * 100).toFixed(1)}% of ${report.total} chars (${report.prefix} cacheable)`;
    assert.ok(
      report.ratio >= floor,
      `${path}: two cards share at least ${(floor * 100).toFixed(0)}% of this prompt, so a new worker on a different card `
        + `reuses that prefix instead of re-paying it. Measured ${(report.ratio * 100).toFixed(1)}% `
        + `(${report.prefix} of ${report.total} chars) — under the floor, so a per-card value moved back into the shared prefix. `
        + `Divergence: ...${report.divergedAt.slice(-80)}`,
    );
  }
  // Reported, so a shrink is visible in the log rather than only in a failure.
  console.log(`prompt cache order: cross-card prefix per path — ${Object.entries(measured).map(([k, v]) => `${k}: ${v}`).join(" · ")}`);
});

// --- The numbers the record quotes, so they cannot rot silently. ------------
// The deliverable was "a cacheable prefix of at least 75%, measured". Measuring
// it is this test's job; printing the per-path characters and estimated tokens is
// what makes the record reproducible from the suite instead of from a session log.
test("the per-path prefix, chars, and estimated tokens are reported", () => {
  const rows = ALL_PATHS.map((path) => {
    const [a, b] = pairs[path];
    const report = cacheReport(a, b);
    const cacheableTokens = Math.ceil(report.prefix / 4);
    const repaidTokens = estimateTokens(b.slice(report.prefix));
    return `${path}: ${report.prefix}/${report.total} chars (${(report.ratio * 100).toFixed(1)}%), `
      + `~${cacheableTokens} cacheable tokens, ~${repaidTokens} re-paid of ~${estimateTokens(b)}`;
  });
  assert.ok(rows.length === ALL_PATHS.length, "every path is measured");
  console.log(`prompt cache economy — ${rows.join(" · ")}`);
});

// --- Reported every run, so the gap cannot be forgotten. --------------------
// `spawn` and `restart` on the same card also share almost nothing: the
// band-boundary handoff is a NEW thread, so it re-pays nearly the whole prompt.
// Reported rather than asserted, because a handoff that legitimately rewrites its
// instructions would move the number and that is not a defect.
test("the same-card handoff cache measurement is visible", () => {
  const handoff = cacheReport(paths.spawn, paths.restart, { label: "spawn -> restart (same card)" });
  assert.ok(handoff.total > 0, "the handoff measurement saw both prompts");
  console.log(
    `prompt cache order: handoff spawn -> restart shares ${handoff.prefix} of ${handoff.total} chars `
      + `(${(handoff.ratio * 100).toFixed(1)}%) · divergence: ...${handoff.divergedAt.slice(-60)}`,
  );
});
