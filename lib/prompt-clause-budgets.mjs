/**
 * The size contract for the shared prompt clauses.
 *
 * Every one of the five spawn paths pays the whole clause bag: measured on this
 * commit, 11,700 of the reseed prompt's 12,490 chars are verbatim shared clause
 * text (93.7%), leaving 790 chars for everything authored for that path. No
 * clause declares how big it is allowed to be, so a sentence added to
 * `DONE_PROTOCOL` costs every path at once and the *smallest* path fails first,
 * with a delta that names a path rather than a cause:
 *
 *     reseed prompt is within budget: 12501 chars ... exceeds the 12500-char
 *     ceiling by 1
 *
 * That error is true and useless. It says the smallest path broke; it cannot say
 * which of thirteen clauses ate the room. This table is the missing half: a
 * ceiling per clause, so a change that grows one names the clause it grew.
 *
 * The ceilings are set from the measured values on the commit that introduced
 * this table, with no headroom beyond a formatting change. Like
 * `scripts/source-debt.json`, they ratchet down: a clause that shrinks should
 * have its ceiling tightened in the same commit, because a ceiling nobody
 * lowers is a ceiling that quietly becomes a budget.
 */

/** Measured 2026-10-19. `null` means the clause is not part of the bag. */
export const CLAUSE_CHAR_CEILINGS = {
  WORKFLOW_INTRO: 179,
  CARD_OWNER_RULES: 706,
  WORKFLOW_SKILLS: 545,
  NEVER_SEED: 177,
  CLI_EQUIVALENTS: 1078,
  RECON_PROTOCOL: 505,
  DRAFT_PROTOCOL: 414,
  TURN_DISCIPLINE: 637,
  COMMIT_STYLE: 379,
  INTERFACE_PICK: 490,
  USER_INPUT_CONTRACT: 1874,
  DONE_PROTOCOL: 2479,
  SPLIT_PROTOCOL: 2237,
  COMMAND_FAILURE_RULE: 144,
};

/**
 * The clauses each spawn path owes.
 *
 * This is the second half of the diagnosis. All three build paths render the
 * identical bag, and that is not a coincidence to preserve — it is a claim that
 * a re-seeded worker needs the split protocol, the commit style and the
 * interface pick just as much as a first spawn. Some of that is true and some of
 * it is not:
 *
 * - `SPLIT_PROTOCOL` (2237 chars) says a split may be proposed *at triage, or at
 *   Prioritization before its choice is committed*. A re-seeded worker is
 *   already past that door, so the clause describes a door it can no longer
 *   walk through — the `bb stelow ask --tag split` it instructs on is refused at
 *   every later stage. That is 18% of the reseed budget spent on an instruction
 *   that cannot be followed.
 * - Everything else stays. `DONE_PROTOCOL`, `USER_INPUT_CONTRACT` and
 *   `CLI_EQUIVALENTS` are exactly the clauses the historical incidents were
 *   about, and a path that dropped one is the regression this suite exists for.
 *
 * Declared per path rather than discovered in a test, so a path's obligations
 * are reviewable in one place. `reseed` is the only difference today; the shape
 * is here so the next one is a line rather than an argument.
 */
export const PATH_CLAUSE_OBLIGATIONS = {
  spawn: "all",
  restart: "all",
  // Re-seeded workers are already past triage, so the split door is behind them.
  reseed: { omit: ["SPLIT_PROTOCOL"] },
  research: { only: ["USER_INPUT_CONTRACT", "DONE_PROTOCOL", "DRAFT_PROTOCOL", "CARD_OWNER_RULES"] },
  explore: { only: ["USER_INPUT_CONTRACT", "DONE_PROTOCOL", "DRAFT_PROTOCOL", "CARD_OWNER_RULES"] },
};

/** The CONST name for a clause given either vocabulary. */
function canonicalClause(clause) {
  if (clause in CLAUSE_CHAR_CEILINGS) return clause;
  const hit = Object.entries(CLAUSE_PROTOCOL_KEYS).find(([, key]) => key === clause);
  return hit ? hit[0] : clause;
}

/** Whether `path` owes `clause`, named by CONST or protocol key. */
export function pathOwesClause(path, clause) {
  const name = canonicalClause(clause);
  const rule = PATH_CLAUSE_OBLIGATIONS[path];
  if (rule === undefined) return true;
  if (rule === "all") return true;
  if (Array.isArray(rule.only)) return rule.only.includes(name);
  if (Array.isArray(rule.omit)) return !rule.omit.includes(name);
  return true;
}

/**
 * The protocol key each budgeted clause is named by in `WORKER_PROTOCOL_CLAUSES`
 * (`server/runtime/worker-protocol-clauses.ts`).
 *
 * The budget table is keyed on the exported CONST name because that is what a
 * reader sees at the definition site; the prompt bag is keyed on the camelCase
 * protocol name because that is what the builder interpolates. One map, so the
 * two vocabularies cannot drift into two lists — and a test pins that every
 * budgeted clause has an entry here, so adding a clause cannot silently escape
 * its budget.
 */
export const CLAUSE_PROTOCOL_KEYS = {
  WORKFLOW_INTRO: "workflowIntro",
  CARD_OWNER_RULES: "cardOwnerRules",
  WORKFLOW_SKILLS: "workflowSkills",
  NEVER_SEED: "neverSeed",
  CLI_EQUIVALENTS: "cliEquivalents",
  RECON_PROTOCOL: "reconProtocol",
  DRAFT_PROTOCOL: "draftProtocol",
  TURN_DISCIPLINE: "turnDiscipline",
  COMMIT_STYLE: "commitStyle",
  INTERFACE_PICK: "interfacePick",
  USER_INPUT_CONTRACT: "userInputContract",
  DONE_PROTOCOL: "doneProtocol",
  SPLIT_PROTOCOL: "splitProtocol",
  COMMAND_FAILURE_RULE: "commandFailureRule",
};
