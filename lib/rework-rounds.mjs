/**
 * Rework-round budget for the execution↔audit gap loop.
 *
 * A critique that escalates gaps creates rework scopes via `gap-scopes`;
 * the worker executes them, re-runs the critique, and the next critique may
 * escalate again. Each `gap-scopes` run that creates at least one scope is
 * one round. Without a ceiling a card can oscillate forever — every return
 * to audit resets the done-nudge budget (it only counts inside audit), so
 * nothing else stops the cycle.
 *
 * The ceiling is a leash, not a quality signal: gains are front-loaded
 * (rounds 1-2 do the heavy lifting, 3-4 usually pay, past 5 is churn), and a
 * fixed count alone never certifies quality. Hitting the cap is an honest
 * stop with three named exits, never a park without a door.
 */

export const MAX_REWORK_ROUNDS = 3;

/** Rounds already spent on this workflow entry. Malformed reads as zero. */
export function reworkRoundsOf(entry) {
  const raw = entry && typeof entry === "object" ? entry.rework_rounds : undefined;
  const rounds = typeof raw === "number" ? Math.floor(raw) : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(rounds) && rounds > 0 ? rounds : 0;
}

/** True when the next escalation would exceed the budget. */
export function reworkCapReached(entry) {
  return reworkRoundsOf(entry) >= MAX_REWORK_ROUNDS;
}

/** The round counter after a `gap-scopes` run. Only creating work spends. */
export function nextReworkRounds(entry, createdCount) {
  const rounds = reworkRoundsOf(entry);
  return createdCount > 0 ? rounds + 1 : rounds;
}

/** Cap refusal: names the three exits that already exist, so the card never
 * parks without a door. Skipped scopes count as resolved at done/verify. */
export function reworkCapRefusal(rounds, unscoped) {
  const names = (Array.isArray(unscoped) ? unscoped : [])
    .map((gap) => `- ${typeof gap === "string" ? gap : gap?.description ?? "unnamed gap"}`)
    .join("\n");
  const count = Array.isArray(unscoped) ? unscoped.length : 0;
  return [
    `Rework budget reached (${rounds}/${MAX_REWORK_ROUNDS} rounds)`,
    `with ${count} escalated gap(s) still without a rework scope — no new scopes were created:`,
    names,
    "Pick one: resolve the escalation inline and re-run the critique to reclassify it as fixed;",
    "skip the rework scope that would carry it (skipped counts as resolved at done);",
    "or run `bb stelow split` to move it to a new card.",
  ].join("\n");
}
