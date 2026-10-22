import { buildWorkflowPrompt } from "./runtime/workflow-shared.js";

export type CardPromptRules = {
  /** The opening every build path shares, so the prefix is byte-identical. */
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

export type BuildPromptContext = {
  stateDir: string;
  intent: string;
  managedWorktree: boolean;
  knobs: { quality: string; explorationCount: number; explorationHybrid: boolean };
  reviewGates: string;
  reviewRung: string;
  instructions: string | null;
  prompt: string;
};

const MANAGED_WORKTREE_NOTE = [
  "BB provisioned the managed worktree selected by the user. ",
  "Treat your current working directory as the code root; never redirect code changes ",
  "to the project source path used for Stelow's workflow metadata.",
].join("");

export function buildBuildPrompt(
  context: BuildPromptContext,
  rules: CardPromptRules,
): string {
  // One parameterized builder: the shared prefix is byte-identical across
  // spawn/restart/reseed, and only this tail differs per card.
  const tail = [
    context.managedWorktree ? MANAGED_WORKTREE_NOTE : "",
    `Your workflow owns its own state dir (${context.stateDir}) — its state.md holds name, intent, current_stage, status.`,
    `Step 1 — verify intent first: this card starts as intent=\`${context.intent}\` in state.md (pre-seeded when the request already carried one, else`
      + ` \`unknown\`). Read the request, confirm or pick the fitting intent`
      + ` (new-product, feature, bugfix, refactor, investigate) and write it to state.md immediately so the card updates in real time. Ask one concise`
      + ` question via the form above only when genuinely ambiguous. Do NOT load phase skills or do product work before intent is settled.`
      + ` Run knobs (quality=\`${context.knobs.quality}\`,`
      + ` exploration=\`count=${context.knobs.explorationCount} hybrid=${context.knobs.explorationHybrid}\`) and review gates=\`${context.reviewGates}\``
      + ` (${context.reviewRung}) are already recorded in state.md — use them, never re-ask.`,
    "Order of work, always: (1) triage — settle intent and record it in state.md; (2) load only the skills `bb stelow playbook` names for your "
      + "current stage; (3) advance stages and do the work. Use `bb stelow advance <stage>` to change stages (do NOT hand-edit current_stage).",
    `${context.instructions ? `Preset instructions:\n${context.instructions}\n` : ""}Request:\n${context.prompt}`,
  ].filter((part) => part.length > 0).join("\n\n");
  // Explicit per-clause handoff: every clause the shared builder renders is
  // named here, so a caller that stops handing one fails the contract tests
  // instead of silently rendering a weaker prompt.
  return buildWorkflowPrompt(
    {
      workflowIntro: rules.workflowIntro,
      cardOwnerRules: rules.cardOwnerRules,
      workflowSkills: rules.workflowSkills,
      neverSeed: rules.neverSeed,
      cliEquivalents: rules.cliEquivalents,
      reconProtocol: rules.reconProtocol,
      draftProtocol: rules.draftProtocol,
      turnDiscipline: rules.turnDiscipline,
      commitStyle: rules.commitStyle,
      interfacePick: rules.interfacePick,
      userInputContract: rules.userInputContract,
      commandFailureRule: rules.commandFailureRule,
      doneProtocol: rules.doneProtocol,
      splitProtocol: rules.splitProtocol,
    },
    tail,
    { path: "spawn" },
  );
}
