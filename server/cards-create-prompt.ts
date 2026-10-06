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
  interfacePick: string;
  doneProtocol: string;
  splitProtocol: string;
  userInputContract: string;
};

export type BuildPromptContext = {
  stateDir: string;
  intent: string;
  managedWorktree: boolean;
  knobs: { quality: string; supervisor: string; explorationCount: number; explorationHybrid: boolean };
  reviewGates: string;
  reviewRung: string;
  instructions: string | null;
  prompt: string;
};

const BUILD_INITIAL_PROMPT = `%WORKFLOW_INTRO%

%CARD_OWNER_RULES%

%WORKFLOW_SKILLS%

%NEVER_SEED%

Preserve every gate (product, interface, tech plan, diff).

%CLI_EQUIVALENTS%

%RECON_PROTOCOL%

%DRAFT_PROTOCOL%

%TURN_DISCIPLINE%

%COMMIT_STYLE%

%INTERFACE_PICK%

%USER_INPUT_CONTRACT%

%DONE_PROTOCOL%

%SPLIT_PROTOCOL%

%MANAGED_WORKTREE%

Your workflow owns its own state dir (%STATE_DIR%) — its state.md holds name, intent, current_stage, status.

Step 1 — verify intent first: this card starts as intent=\`%INTENT%\` in state.md (pre-seeded when the request already carried one, else\
\`unknown\`). Read the request, confirm or pick the fitting intent\
(new-product, feature, bugfix, refactor, investigate) and write it to state.md immediately so the card updates in real time. Ask one concise\
question via the form above only when genuinely ambiguous. Do NOT load phase skills or do product work before intent is settled.\
Run knobs (quality=\`%QUALITY%\`, supervisor=\`%SUPERVISOR%\`,
exploration=\`%EXPLORATION%\`) and review gates=\`%REVIEW_GATES%\`
(%REVIEW_RUNG%) are already recorded in state.md — use them, never re-ask.

Order of work, always: (1) triage — settle intent and record it in state.md; (2) load only the skills \`bb stelow playbook\` names for your \
current stage; (3) advance stages and do the work. Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). If \
a \`bb stelow\` command fails, read its stderr once and continue the workflow — do NOT spend the turn debugging the CLI; report the exact error \
and move on.

%INSTRUCTIONS%Request:
%REQUEST%`;

const MANAGED_WORKTREE_NOTE = [
  "BB provisioned the managed worktree selected by the user. ",
  "Treat your current working directory as the code root; never redirect code changes ",
  "to the project source path used for Stelow's workflow metadata.",
].join("");

export function buildBuildPrompt(
  context: BuildPromptContext,
  rules: CardPromptRules,
): string {
  const values: Record<string, string> = {
    WORKFLOW_INTRO: rules.workflowIntro,
    WORKFLOW_SKILLS: rules.workflowSkills,
    STATE_DIR: context.stateDir,
    CARD_OWNER_RULES: rules.cardOwnerRules,
    MANAGED_WORKTREE: context.managedWorktree ? MANAGED_WORKTREE_NOTE : "",
    INTENT: context.intent,
    QUALITY: context.knobs.quality,
    SUPERVISOR: context.knobs.supervisor,
    EXPLORATION: `count=${context.knobs.explorationCount} hybrid=${context.knobs.explorationHybrid}`,
    REVIEW_GATES: context.reviewGates,
    REVIEW_RUNG: context.reviewRung,
    NEVER_SEED: rules.neverSeed,
    CLI_EQUIVALENTS: rules.cliEquivalents,
    RECON_PROTOCOL: rules.reconProtocol,
    DRAFT_PROTOCOL: rules.draftProtocol,
    TURN_DISCIPLINE: rules.turnDiscipline,
    COMMIT_STYLE: rules.commitStyle,
    INTERFACE_PICK: rules.interfacePick,
    USER_INPUT_CONTRACT: rules.userInputContract,
    DONE_PROTOCOL: rules.doneProtocol,
    SPLIT_PROTOCOL: rules.splitProtocol,
    INSTRUCTIONS: context.instructions ? `Preset instructions:\n${context.instructions}\n` : "",
    REQUEST: context.prompt,
  };
  // The replacer receives (match, capture, offset, string): reading the first
  // argument as the token name looks up "%STATE_DIR%" and silently renders
  // every clause empty, which ships a worker with no request body, no intent,
  // and no protocol at all. The name comes from the capture group.
  return BUILD_INITIAL_PROMPT.replace(/%([A-Z_]+)%/g, (_token, name: string) => values[name] ?? "");
}
