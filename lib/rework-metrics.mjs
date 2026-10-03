/**
 * Whether the critique loop is converging, or re-finding the same thing.
 *
 * The gap tally answers "how bad was this review". It cannot answer the question
 * a reader actually has on the second pass: *did we fix it, or did we find it
 * again?* Rework is that second question, and it was unmeasurable because the
 * round boundary was destroyed on the way out — `critique-gap-state` collected
 * every critique artifact as a separate round and then joined them with
 * newlines before publishing, so by the time anything read them, a gap fixed
 * in round 1 and re-opened in round 3 was indistinguishable from a gap that was
 * only ever found once.
 *
 * The definition is deliberately narrow, because the loose one is useless:
 *
 *   rework = a finding that reappears in a LATER round, after an earlier round
 *            already recorded it as resolved (`fixed` or `documented`).
 *
 * Not counted as rework:
 *
 * - a gap still open (`escalate`) in a later round. It was never closed, so
 *   nothing was reworked — counting it would punish a loop that is correctly
 *   waiting on a decision.
 * - a finding appearing for the first time in round 2. That is new work
 *   discovered later, which is a different number.
 * - two different gaps sharing a description prefix. Matching is on the
 *   normalised description, because near-matches would make the rate
 *   unfalsifiable.
 *
 * Round 1 is a baseline, not a sample: a card reviewed once has a rework rate
 * of nothing, and that is `null` rather than `0` for the same reason the
 * escalation rate is — one review cannot tell you anything about convergence.
 */

import { gapResolution } from "./gap-registry.mjs";

/** Resolutions that mean the loop is closed on that finding. */
const CLOSED = new Set(["fixed", "documented"]);

/** The description a round is matched on. Whitespace is the only normalisation:
 * the registry is written by a worker, so a re-wrapped line is the same finding
 * and a different sentence is a different one. */
function keyOf(description) {
  return String(description ?? "").replace(/\s+/g, " ").trim();
}

/** The findings one round recorded, as `description -> resolution`. A round that
 * names the same description twice keeps the first, matching the registry's own
 * deduplication so the two never count the same row differently. */
function roundRows(registryGaps) {
  const rows = new Map();
  for (const gap of registryGaps ?? []) {
    const key = keyOf(gap?.description);
    if (!key || rows.has(key)) continue;
    rows.set(key, gapResolution(gap?.resolution));
  }
  return rows;
}

/**
 * Rework across rounds.
 *
 * `rounds` is an array of per-round gap lists, oldest first — one entry per
 * critique artifact on the card, which is the order the manifest lists them and
 * the order `critique-gap-state` already collects them in. The caller owns
 * reading those artifacts; this only compares them.
 *
 * Returns `rounds`, the number of rounds after the first, `reworked` (closed
 * then reopened), `newAfterFirst` (first seen in a later round), and `rate`,
 * which is null until there is a second round to compare against.
 */
export function summarizeRework(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  const perRound = list.map(roundRows);
  const first = perRound[0] ?? new Map();
  // Everything the first round closed, and the round it closed in. A finding
  // closed in round 2 and re-opened in round 4 is still rework of *that* fix.
  const closedAt = new Map();
  perRound.forEach((rows, index) => {
    for (const [key, resolution] of rows) {
      if (!CLOSED.has(resolution)) continue;
      if (!closedAt.has(key)) closedAt.set(key, index);
    }
  });

  const reworked = new Set();
  const newAfterFirst = new Set();
  perRound.forEach((rows, index) => {
    if (index === 0) return;
    for (const key of rows.keys()) {
      // Only a reappearance in a round STRICTLY AFTER the one that closed it.
      // Without the index comparison, a finding is flagged as reworked by the
      // very round that fixed it, so a card that closed everything would report
      // rework on the pass where nothing was found again.
      const closedIn = closedAt.get(key);
      if (closedIn !== undefined && closedIn < index) reworked.add(key);
      else if (!first.has(key)) newAfterFirst.add(key);
    }
  });

  const comparable = Math.max(0, perRound.length - 1);
  return {
    rounds: perRound.length,
    comparable,
    reworked: reworked.size,
    newAfterFirst: newAfterFirst.size,
    rate: comparable > 0 ? reworked.size / comparable : null,
    // Named so a reader can go and look at the finding, which is the only
    // reason to publish a rate at all.
    reworkedDescriptions: [...reworked].sort(),
    oscillatingDescriptions: findOscillating(perRound, reworked),
  };
}

/** Rework that will not converge: a finding closed and then re-opened
 * across three or more rounds means the bar and the artifact disagree,
 * and another unsupervised round re-runs the disagreement. A never-closed
 * escalation repeated across rounds is persistence (it waits on rework,
 * correctly), not oscillation — only reworked keys qualify. */
function findOscillating(perRound, reworked) {
  const appearances = new Map();
  for (const rows of perRound) {
    for (const key of rows.keys()) appearances.set(key, (appearances.get(key) ?? 0) + 1);
  }
  return [...reworked]
    .filter((key) => (appearances.get(key) ?? 0) >= 3)
    .sort();
}

/**
 * The rework line, or nothing when there is nothing to say.
 *
 * Silent for a single-round card and for a clean loop, because a metric that is
 * always on screen is a number nobody learns to read — the same rule the
 * reviewer-coverage line follows.
 */
export function reworkMetricLine(summary) {
  const s = summary && typeof summary === "object" ? summary : summarizeRework([]);
  if (s.comparable === 0 || s.reworked === 0) return "";
  const plural = s.rounds === 2 ? "a second review" : `${s.rounds} reviews`;
  const base = `Rework: ${s.reworked} finding(s) re-opened after ${plural} (${Math.round(s.rate * 100)}% of passes).`;
  const oscillating = Array.isArray(s.oscillatingDescriptions) ? s.oscillatingDescriptions : [];
  if (oscillating.length === 0) return base;
  return [
    base,
    `Oscillation: ${oscillating.length} finding(s) fixed and re-opened across 3+ rounds`,
    `(${oscillating.join("; ")}) — the bar and the artifact disagree; needs a human, not another round.`,
  ].join(" ");
}
