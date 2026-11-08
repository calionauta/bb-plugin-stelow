import { WORKFLOW_INTRO, WORKFLOW_SKILLS } from "./plugin-protocols.js";
import { buildWorkflowPrompt } from "./workflow-shared.js";

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
    commandFailureRule: string;
    interfacePick: string;
    doneProtocol: string;
    splitProtocol: string;
    userInputContract: string;
  };
};

function stateOwnership(input: RestartPromptInput): string {
  const fallback = input.stateDir
    ? ""
    : " Resolve the exact path from stelow.json; its state.md holds name, intent, current_stage, status.";
  return `This worker was re-seeded. Your state dir is (${input.stateHint}) — its state.md holds name, intent, `
    + `current_stage, status.${fallback} Use \`bb stelow advance <stage>\` to change stages `
    + "(do NOT hand-edit current_stage).";
}

function intentContract(intent: string): string {
  if (intent !== "unknown") return "Use it — do NOT ask the user to pick or confirm intent again.";
  return "It is still unknown, so your FIRST job is triage: classify it (new-product, feature, bugfix, refactor, or "
    + "investigate), write it to state.md immediately, and only then continue — ask via the form below only if genuinely ambiguous.";
}

function previousWorkerContext(threadId: string | null): string {
  if (!threadId) return "";
  return ` Previous worker thread: ${threadId} (archived before this handoff). If state.md is thin — `
    + `e.g. the previous worker stalled silently — its turn history may hold the missing context; retrieve it with `
    + `\`bb thread output ${threadId}\`.`;
}

function restartContract(input: RestartPromptInput): string {
  return `You are being restarted mid-workflow at a stage boundary so a new preset can take over for this phase. Read your state.md `
    + `and transitions.md, and CONTINUE the workflow from the current stage. Do not restart from triage; do not re-confirm what is already `
    + `settled in state.md. Pick up exactly where the workflow left off.${previousWorkerContext(input.card.worker_thread_id)}`;
}

function intentAndOrder(input: RestartPromptInput): string {
  return `Intent is currently \`${input.card.intent}\` in state.md. ${intentContract(input.card.intent)} `
    + `Order of work, always: (1) settle intent; (2) load the workflow skills; (3) continue from the current stage.`;
}

export function buildWorkerRestartPrompt(input: RestartPromptInput): string {
  // One parameterized builder: the shared prefix is byte-identical with the
  // spawn and reseed paths; only this tail differs per card and per handoff.
  // Every clause the shared builder renders is named off input.protocols, so a
  // caller that stops handing one fails the contract tests instead of silently
  // rendering a weaker prompt.
  const protocols = {
    workflowIntro: WORKFLOW_INTRO,
    cardOwnerRules: input.protocols.cardOwnerRules,
    workflowSkills: WORKFLOW_SKILLS,
    neverSeed: input.protocols.neverSeed,
    cliEquivalents: input.protocols.cliEquivalents,
    reconProtocol: input.protocols.reconProtocol,
    draftProtocol: input.protocols.draftProtocol,
    turnDiscipline: input.protocols.turnDiscipline,
    commitStyle: input.protocols.commitStyle,
    interfacePick: input.protocols.interfacePick,
    userInputContract: input.protocols.userInputContract,
    commandFailureRule: input.protocols.commandFailureRule,
    doneProtocol: input.protocols.doneProtocol,
    splitProtocol: input.protocols.splitProtocol,
  };
  const tail = [
    stateOwnership(input),
    restartContract(input),
    intentAndOrder(input),
    `${input.instructions ? `Preset instructions:\n${input.instructions}\n` : ""}Request:\n${input.card.prompt}`,
  ].join("\n\n");
  return buildWorkflowPrompt(protocols, tail);
}
