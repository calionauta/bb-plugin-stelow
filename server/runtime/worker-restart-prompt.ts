type RestartPromptInput = {
  card: {
    intent: string;
    prompt: string;
    worker_thread_id: string | null;
  };
  instructions: string;
  stateHint: string;
  stateDir: string | null;
  protocols: {
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
};

const WORKFLOW_SKILLS = `The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-*) are provided by this plugin — \
start by loading them (they live under the plugin's skills directory; \`bb skill list\` shows them). The product strategy playbooks \
(stelow-product-*) are also provided by this plugin — check \`bb skill list\` first, and only fetch via \`npx skills add calionauta/stelow\` \
if one is missing.`;


function stateOwnership(input: RestartPromptInput): string {
  const fallback = input.stateDir
    ? ""
    : " Resolve the exact path from stelow.json; its state.md holds name, intent, current_stage, status.";
  return `You are running a Stelow workflow inside the bb-plugin-stelow panel. The host re-seeded your per-workflow state, \
transitions.md, and stelow.json. Your workflow owns its own state dir (${input.stateHint}) — its state.md holds name, intent, \
current_stage, status.${fallback} ${input.protocols.cardOwnerRules} ${WORKFLOW_SKILLS} Use \`bb stelow advance <stage>\` to change \
stages (do NOT hand-edit current_stage). ${input.protocols.neverSeed} Preserve every gate (product, interface, tech plan, diff).`;
}

function intentContract(intent: string): string {
  if (intent !== "unknown") return "Use it — do NOT ask the user to pick or confirm intent again.";
  return "It is still unknown, so your FIRST job is triage: classify it (new-product, feature, bugfix, refactor, or \
investigate), write it to state.md immediately, and only then continue — ask via the form below only if genuinely ambiguous.";
}

function previousWorkerContext(threadId: string | null): string {
  if (!threadId) return "";
  return ` Previous worker thread: ${threadId} (archived before this handoff). If state.md is thin — \
e.g. the previous worker stalled silently — its turn history may hold the missing context; retrieve it with \
\`bb thread output ${threadId}\`.`;
}

function restartContract(input: RestartPromptInput): string {
  return `You are being restarted mid-workflow at a stage boundary so a new preset can take over for this phase. Read your state.md \
and transitions.md, and CONTINUE the workflow from the current stage. Do not restart from triage; do not re-confirm what is already \
settled in state.md. Pick up exactly where the workflow left off.${previousWorkerContext(input.card.worker_thread_id)}

${input.protocols.userInputContract}

${input.protocols.interfacePick} For unselected gates, write the approval receipt yourself \
(.stelow/approvals/{dirHash}/{file}.approved.md) and advance; for selected gates, open a structured ask instead. Stop when the user \
archives the card or the workflow reaches \`audit\`.`;
}

function intentAndOrder(input: RestartPromptInput): string {
  return `Intent is currently \`${input.card.intent}\` in state.md. ${intentContract(input.card.intent)} \
Order of work, always: (1) settle intent; (2) load the workflow skills; (3) continue from the current stage. \
If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; \
report the exact error and move on.`;
}

export function buildWorkerRestartPrompt(input: RestartPromptInput): string {
  const protocols = input.protocols;
  return `${stateOwnership(input)} ${protocols.cliEquivalents} ${protocols.reconProtocol} ${protocols.draftProtocol}

${protocols.turnDiscipline}

${protocols.commitStyle}

${intentAndOrder(input)}

${restartContract(input)}

${protocols.doneProtocol}

${protocols.splitProtocol}

${input.instructions ? `Preset instructions:\n${input.instructions}\n` : ""}Request:\n${input.card.prompt}`;
}
