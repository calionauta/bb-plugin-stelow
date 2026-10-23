/**
 * The size contract for the shared prompt clauses.
 *
 * Every build path pays the whole clause bag: measured on this commit,
 * 11,832 of the reseed prompt's 12,420 chars are verbatim shared clause text
 * (95.3%), leaving 588 chars for everything authored for that path. No
 * clause declares how big it is allowed to be, so a sentence added to
 * `DONE_PROTOCOL` costs every path at once and the *smallest* path fails
 * first, with a delta that names a path rather than a cause:
 *
 *     reseed prompt is within budget: 12441 chars ... exceeds the 12440-char
 *     ceiling by 1
 *
 * That error is true and useless. It says the smallest path broke; it cannot
 * say which of fourteen clauses ate the room. This table is the missing half:
 * a ceiling per clause, so a change that grows one names the clause it grew.
 *
 * The ceilings are set from the measured values on the commit that introduced
 * this table, with no headroom beyond a formatting change. Like
 * `scripts/source-debt.json`, they ratchet down: a clause that shrinks should
 * have its ceiling tightened in the same commit, because a ceiling nobody
 * lowers is a ceiling that quietly becomes a budget.
 *
 * The keys are the protocol keys the clause bags use
 * (`server/runtime/worker-protocol-clauses.ts` for the build paths and
 * `server/runtime/track-protocol-clauses.ts` for the two tracks), plus the one
 * line the prompt builder owns (`gatePreservation`). Keying on the bags' own
 * keys is what keeps this table from becoming a second vocabulary: there is no
 * map from one naming to the other, so the two cannot drift apart.
 *
 * Two bags, one table: a clause's SIZE does not depend on which path renders
 * it, so both bags are measured here and a key that appears in neither is
 * reported as `unbudgeted`. The one place the two genuinely differ is
 * `doneProtocol` (the build completion payload) versus `doneProtocolTrack` (the
 * track rule), which is why the track half is its own key rather than a second
 * view of the same one.
 */

/** Measured 2026-10-22 against master (0.87.0, after the stranded-work merge),
 * and re-measured 2026-10-23 when the completion rule was split per track:
 * `doneProtocol` is now the core rule plus the BUILD payload only (the track
 * half lives under `doneProtocolTrack`), so its ceiling moved down by exactly
 * the sentence that left it. Nothing here is raised to make a change fit:
 * a ceiling is a measurement, never a target. */
export const CLAUSE_CHAR_CEILINGS = {
  workflowIntro: 179,
  cardOwnerRules: 706,
  workflowSkills: 545,
  neverSeed: 177,
  gatePreservation: 58,
  cliEquivalents: 1078,
  reconProtocol: 505,
  reviewProtocol: 227,
  draftProtocol: 414,
  turnDiscipline: 637,
  commitStyle: 379,
  interfacePick: 490,
  userInputContract: 1874,
  commandFailureRule: 144,
  doneProtocol: 2409,
  doneProtocolTrack: 178,
  splitProtocol: 2237,
};

/**
 * How much slack a ceiling may keep before it counts as a budget.
 *
 * A formatting change is worth a few characters; a sentence is worth a
 * hundred. Forty is the line between the two: below it, a ceiling that sits
 * above the measured text is stale; above it, the next author inherits room
 * nobody decided to give them.
 */
export const CEILING_SLACK = 40;

/**
 * What the ceilings say about a set of clause texts.
 *
 * Three ways the table and the reality can part company, each named:
 *
 *   - `overBudget` — a clause grew past its ceiling. This is the case the
 *     table exists for: the delta names the clause, not the path that broke.
 *   - `unbudgeted` — a ceiling that resolves to no clause, so it guards
 *     nothing. A rename that orphans an entry is a silent pass otherwise.
 *   - `loose` — a ceiling that sits far above the measured text. The clause
 *     shrank and nobody tightened the number, which is how a ceiling quietly
 *     becomes a budget.
 */
export function clauseBudgetFindings(texts) {
  const overBudget = [];
  const unbudgeted = [];
  const loose = [];
  for (const [clause, ceiling] of Object.entries(CLAUSE_CHAR_CEILINGS)) {
    const text = texts[clause];
    if (typeof text !== "string") {
      unbudgeted.push(clause);
      continue;
    }
    const length = text.length;
    if (length > ceiling) {
      overBudget.push(`${clause}: ${length} chars, ceiling ${ceiling} (+${length - ceiling})`);
    } else if (ceiling - length > CEILING_SLACK) {
      loose.push(`${clause}: ${length} chars but ceiling is ${ceiling} (${ceiling - length} spare — tighten it)`);
    }
  }
  return { overBudget, unbudgeted, loose };
}

/**
 * The clauses a rendered prompt carries that no ceiling covers.
 *
 * The other direction of the table: a clause that renders but has no ceiling
 * escapes the budget entirely, which is how a clause reaches 2,479 chars
 * without anyone deciding it should.
 */
export function clausesWithoutCeiling(rendered) {
  return rendered.filter((clause) => !(clause in CLAUSE_CHAR_CEILINGS));
}
