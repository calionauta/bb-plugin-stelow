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
  return [
    protocols.workflowIntro,
    protocols.cardOwnerRules,
    protocols.workflowSkills,
    protocols.neverSeed,
    "Preserve every gate (product, interface, tech plan, diff).",
    protocols.cliEquivalents,
    protocols.reconProtocol,
    protocols.draftProtocol,
    protocols.turnDiscipline,
    protocols.commitStyle,
    protocols.interfacePick,
    protocols.userInputContract,
    protocols.commandFailureRule,
    protocols.doneProtocol,
    protocols.splitProtocol,
  ].join("\n\n");
}

export function buildWorkflowPrompt(
  protocols: BuildProtocols,
  tail: string,
): string {
  return `${buildSharedPrefix(protocols)}\n\n${tail}`;
}

export type { BuildVariant as BuildPromptVariant };
