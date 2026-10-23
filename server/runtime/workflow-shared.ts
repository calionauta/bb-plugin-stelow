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

export type BuildVariant = "spawn" | "restart" | "reseed";

/**
 * The one line the builder owns, rather than a protocol the caller supplies.
 *
 * It is a line every build prompt carries, so it belongs to the same size
 * contract as the clauses — a line that is not budgeted is a line that can
 * grow without anyone deciding it should.
 */
export const BUILDER_CLAUSES = {
  gatePreservation: "Preserve every gate (product, interface, tech plan, diff).",
} as const;

/**
 * The order the shared prefix renders in, and the one list that says so.
 *
 * The bag (`WORKER_PROTOCOL_CLAUSES`) owns the clause TEXTS; this owns their
 * SEQUENCE. Two lists, two owners, and the sequence was previously written
 * inline in the function below — so the render order and the bag could
 * disagree about what a prompt contains, and the size contract could not
 * tell which keys the prompt actually renders.
 *
 * The order is not the bag's declaration order on purpose: the intro has to
 * open the prompt (a provider reuses the longest common prefix), and the
 * completion protocol reads last.
 */
export const CLAUSE_ORDER = [
  "workflowIntro",
  "cardOwnerRules",
  "workflowSkills",
  "neverSeed",
  "gatePreservation",
  "cliEquivalents",
  "reconProtocol",
  "draftProtocol",
  "turnDiscipline",
  "commitStyle",
  "interfacePick",
  "userInputContract",
  "commandFailureRule",
  "doneProtocol",
  "splitProtocol",
] as const;

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
export function buildSharedPrefix(protocols: BuildProtocols): string {
  return CLAUSE_ORDER.map((clause) =>
    clause in BUILDER_CLAUSES
      ? BUILDER_CLAUSES[clause as keyof typeof BUILDER_CLAUSES]
      : protocols[clause as keyof BuildProtocols],
  ).join("\n\n");
}

export function buildWorkflowPrompt(
  protocols: BuildProtocols,
  tail: string,
): string {
  return `${buildSharedPrefix(protocols)}\n\n${tail}`;
}
