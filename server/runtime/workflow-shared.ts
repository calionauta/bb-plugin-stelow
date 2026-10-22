export type BuildProtocols = {
  workflowIntro: string;
  workflowSkills: string;
  cardOwnerRules: string;
  neverSeed: string;
  cliEquivalents: string;
  reconProtocol: string;
  draftProtocol: string;
  turnDiscipline: string;
  commitStyle: string;
  commandFailureRule: string;
  interfacePick: string;
  doneProtocol: string;
  splitProtocol: string;
  userInputContract: string;
};

import { pathOwesClause } from "../../lib/prompt-clause-budgets.mjs";

export type BuildVariant = "spawn" | "restart" | "reseed";

/**
 * The one parameterized builder for the three build paths.
 *
 * Spawn, restart, and reseed used to own near-identical templates that each
 * listed the clause order by hand. Hand-listed orders drift — one path moves a
 * clause above the state dir, another leaves it below, and the cache prefix
 * shrinks to the shorter of the two. The shared prefix below is built once, so
 * every variant opens byte-identically and the cacheable region ends where the
 * per-card tail begins on every path. Every clause is read off the protocols
 * the caller hands in (sentinels in tests, consts in prod), so a caller that
 * stops handing a clause renders a visibly weaker prompt instead of silently
 * falling back to the const.
 */
/**
 * The clause bag in render order, with the name each clause is budgeted under.
 *
 * `null` marks a line the builder owns rather than a caller-supplied protocol,
 * so the budget table can skip it without a second list.
 */
const CLAUSE_ORDER = [
  ["WORKFLOW_INTRO", "workflowIntro"],
  ["CARD_OWNER_RULES", "cardOwnerRules"],
  ["WORKFLOW_SKILLS", "workflowSkills"],
  ["NEVER_SEED", "neverSeed"],
  [null, "Preserve every gate (product, interface, tech plan, diff)."],
  ["CLI_EQUIVALENTS", "cliEquivalents"],
  ["RECON_PROTOCOL", "reconProtocol"],
  ["DRAFT_PROTOCOL", "draftProtocol"],
  ["TURN_DISCIPLINE", "turnDiscipline"],
  ["COMMIT_STYLE", "commitStyle"],
  ["INTERFACE_PICK", "interfacePick"],
  ["USER_INPUT_CONTRACT", "userInputContract"],
  [null, "commandFailureRule"],
  ["DONE_PROTOCOL", "doneProtocol"],
  ["SPLIT_PROTOCOL", "splitProtocol"],
];

export function buildSharedPrefix(
  protocols: BuildProtocols,
  { path }: { path?: BuildVariant } = {},
): string {
  const lines = [];
  for (const [clauseName, source] of CLAUSE_ORDER) {
    // A path only renders the clauses it owes. `pathOwesClause` reads the
    // declared table, so this is not a discovery: a clause a path does not owe
    // renders NOTHING — never a fallback to the const — which is what keeps an
    // omission visible instead of silently weaker-but-present.
    if (clauseName && path && !pathOwesClause(path, clauseName)) continue;
    const text = typeof source === "string" && (source in protocols)
      ? protocols[source as keyof BuildProtocols]
      : source;
    if (text) lines.push(text);
  }
  return lines.join("\n\n");
}

export function buildWorkflowPrompt(
  protocols: BuildProtocols,
  tail: string,
  options: { path?: BuildVariant } = {},
): string {
  return `${buildSharedPrefix(protocols, options)}\n\n${tail}`;
}

export type { BuildVariant as BuildPromptVariant };
