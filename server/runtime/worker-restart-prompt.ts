import { WORKFLOW_INTRO, WORKFLOW_SKILLS } from "./plugin-protocols.js";

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


function stateOwnership(input: RestartPromptInput): string {
  const fallback = input.stateDir
    ? ""
    : " Resolve the exact path from stelow.json; its state.md holds name, intent, current_stage, status.";
  // Intro and the per-card facts only. The clauses are rendered by the template, in
  // the canonical order the spawn and reseed paths also use — this function used to
  // repeat them, which rendered the ask contract twice and pushed the prompt to
  // 21,421 characters against a 13,500 ceiling.
  return `This worker was re-seeded. Your state dir is (${input.stateHint}) — its state.md holds name, intent, `
    + `current_stage, status.${fallback} Use \`bb stelow advance <stage>\` to change stages `
    + "(do NOT hand-edit current_stage).";
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
  // Per-card facts only. This used to render the ask contract and the gate clause as
  // well, which put two CLAUSES after a per-card value — so the shared run ended at
  // the state dir and 3,389 characters that every path renders identically were
  // uncacheable. Clauses belong above this line, in the canonical order.
  return `You are being restarted mid-workflow at a stage boundary so a new preset can take over for this phase. Read your state.md \
and transitions.md, and CONTINUE the workflow from the current stage. Do not restart from triage; do not re-confirm what is already \
settled in state.md. Pick up exactly where the workflow left off.${previousWorkerContext(input.card.worker_thread_id)}`;
}

function intentAndOrder(input: RestartPromptInput): string {
  return `Intent is currently \`${input.card.intent}\` in state.md. ${intentContract(input.card.intent)} \
Order of work, always: (1) settle intent; (2) load the workflow skills; (3) continue from the current stage. \
If a \`bb stelow\` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; \
report the exact error and move on.`;
}

export function buildWorkerRestartPrompt(input: RestartPromptInput): string {
  const protocols = input.protocols;
  return `${WORKFLOW_INTRO}\n\n${protocols.cardOwnerRules}\n\n${WORKFLOW_SKILLS}\n\n`
    + `${protocols.neverSeed}\n\nPreserve every gate (product, interface, tech plan, diff).\n\n`
    + `${protocols.cliEquivalents}\n\n${protocols.reconProtocol}\n\n${protocols.draftProtocol}\n\n`
    + `${protocols.turnDiscipline}\n\n${protocols.commitStyle}\n\n`
    + `${protocols.interfacePick}\n\n${protocols.userInputContract}\n\n`
    + `${protocols.doneProtocol}\n\n${protocols.splitProtocol}\n\n`
    + `${stateOwnership(input)}\n\n${restartContract(input)}\n\n${intentAndOrder(input)}\n\n`
    + `${input.instructions ? `Preset instructions:\n${input.instructions}\n` : ""}Request:\n${input.card.prompt}`;
}
