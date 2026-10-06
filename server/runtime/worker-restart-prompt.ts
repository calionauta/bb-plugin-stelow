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

// A pointer, not a discovery instruction. It used to name the `stelow-workflow-*`
// glob and tell the worker to find them with `bb skill list`, which is both the
// thing `bb stelow playbook` was built to replace (its own docstring: workers
// "burned whole turns on discovery") and a contradiction of the CLI_EQUIVALENTS
// clause that says never to discover skills that way. The glob is 17 skills whose
// entry documents total 215,756 bytes (~54k tokens) against a 12,100-character
// prompt, so an eager load is an order of magnitude more expensive than the
// prompt that asked for it.
const WORKFLOW_SKILLS = `Read \`bb stelow playbook\` and load exactly the skills it names, in the order it lists \
them — it is the whole reading list for your current stage, and it already resolves the plugin's skill paths. Do not \
search for skills, do not load a stage skill you have not reached, and do not fetch anything via \`npx skills add\` unless \
the playbook reports a path missing. That report means a broken install: say so instead of working around it.`;


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
