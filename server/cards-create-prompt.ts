export type CardPromptRules = {
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
};

export type BuildPromptContext = {
  stateDir: string;
  intent: string;
  managedWorktree: boolean;
  appetite: string;
  reviewGates: string;
  reviewRung: string;
  instructions: string | null;
  prompt: string;
};

const BUILD_INITIAL_PROMPT = `You are running a Stelow workflow inside the bb-plugin-stelow panel. Your workflow owns its own state dir\
(%STATE_DIR%) — its state.md holds\
name, intent, current_stage, status. %CARD_OWNER_RULES%

%MANAGED_WORKTREE%

Step 1 — verify intent first: this card starts as intent=\`%INTENT%\` in state.md (pre-seeded when the request already carried one, else\
\`unknown\`). Read the request, confirm or pick the fitting intent\
(new-product, feature, bugfix, refactor, investigate) and write it to state.md immediately so the card updates in real time. Ask one concise\
question via the form below only when genuinely ambiguous. Do NOT load phase skills or do product work before intent is settled.\
Appetite=\`%APPETITE%\` and review gates=\`%REVIEW_GATES%\` (%REVIEW_RUNG%) are already recorded in state.md — use them, never re-ask.

Order of work, always: (1) triage — settle intent and record it in state.md; (2) load the workflow skills; (3) advance stages and do the work. If\
a \`bb stelow\` command fails, read its stderr once and continue the workflow — do NOT spend the turn debugging the CLI; report the exact error\
and move on.

Load the workflow skills first (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-* via \`bb skill list\`). Use \`bb stelow advance\
<stage>\` to change stages (do NOT hand-edit current_stage). %NEVER_SEED% Preserve every gate (product, interface, tech plan, diff).\
%CLI_EQUIVALENTS% %RECON_PROTOCOL% %DRAFT_PROTOCOL%

%TURN_DISCIPLINE%

%COMMIT_STYLE%

CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form, NEVER just write text like "waiting for your choice":

    bb stelow ask --thread "$BB_THREAD_ID" \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--option "<label 3>" ...] [--multiple]

Batch independent questions into ONE ask call by repeating --question groups (each with its own label sets) so the user answers them together\
instead of being pinged one by one. Ask dependent questions (where Q2 needs Q1's answer) one at a time. When the human must compare artifacts to\
decide (interface picks, plan reviews), attach each option's evidence: --desc for trade-offs, --preview for the inline glance, --artifact for the\
workspace-relative file they can open.

Before asking, summarize what you read so the user can answer with context. Do not skip triage; do not start shaping before triage is settled.\
Each ask blocks until answered; the card stays in its column and signals it is waiting for an answer. On timeout ("No response after Ns"), STOP\
and wait — the question stays answerable on the card and the answer arrives as a message. Never re-ask the same question. %INTERFACE_PICK% For\
unselected gates, write the approval receipt yourself (.stelow/approvals/{dirHash}/{file}.approved.md) and advance; for selected gates, open a\
structured ask instead. Stop when the user archives the card or the workflow reaches \`audit\`.

%DONE_PROTOCOL%

%SPLIT_PROTOCOL%

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
    STATE_DIR: context.stateDir,
    CARD_OWNER_RULES: rules.cardOwnerRules,
    MANAGED_WORKTREE: context.managedWorktree ? MANAGED_WORKTREE_NOTE : "",
    INTENT: context.intent,
    APPETITE: context.appetite,
    REVIEW_GATES: context.reviewGates,
    REVIEW_RUNG: context.reviewRung,
    NEVER_SEED: rules.neverSeed,
    CLI_EQUIVALENTS: rules.cliEquivalents,
    RECON_PROTOCOL: rules.reconProtocol,
    DRAFT_PROTOCOL: rules.draftProtocol,
    TURN_DISCIPLINE: rules.turnDiscipline,
    COMMIT_STYLE: rules.commitStyle,
    INTERFACE_PICK: rules.interfacePick,
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
