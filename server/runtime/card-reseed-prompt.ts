import { buildWorkflowPrompt as buildSharedWorkflowPrompt } from "./workflow-shared.js";
import { WORKFLOW_INTRO, WORKFLOW_SKILLS } from "./plugin-protocols.js";
import type { WorkerCard } from "../workers-types.js";
import type {
  ExploreWorkerPromptInput,
  ResearchWorkerPromptInput,
} from "./track-prompts.js";

type Protocols = {
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
type Params = {
  instructions: string;
};
type Seed = { stateDir?: string | null };
type Research = {
  label: string;
  id: string;
  skill: string;
};
type Explore = { id: string; label: string; skill: string };

type PromptInput = {
  card: WorkerCard;
  rootPath: string;
  intent: string;
  seed: Seed;
  params: Params;
  protocols: Protocols;
  research: Research | null;
  explore: Explore | null;
  roundNo: number;
  roundStamp: string;
  roundFile: string;
  researchPrompt: (input: ResearchWorkerPromptInput) => string;
  explorePrompt: (input: ExploreWorkerPromptInput) => string;
};

export function buildReseedPrompt(input: PromptInput): string {
  if (input.research) return input.researchPrompt(researchTrackInput(input, input.research));
  if (input.explore) return input.explorePrompt(exploreTrackInput(input, input.explore));
  return buildWorkflowPrompt(input);
}

function commonTrackInput(input: PromptInput) {
  return {
    displayName: input.card.display_name ?? input.card.name,
    prompt: input.card.prompt,
    stateDirText: stateDirText(input.seed),
    workspaceRoot: input.rootPath,
    instructions: input.params.instructions,
    flavor: "reseed" as const,
    previousThreadId: input.card.worker_thread_id,
  };
}

function researchTrackInput(
  input: PromptInput,
  research: Research,
): ResearchWorkerPromptInput {
  return {
    ...commonTrackInput(input),
    strategyLabel: research.label,
    strategyId: research.id,
    strategySkill: research.skill,
    roundNo: input.roundNo,
    roundStamp: input.roundStamp,
    roundFile: input.roundFile,
  };
}

function exploreTrackInput(
  input: PromptInput,
  explore: Explore,
): ExploreWorkerPromptInput {
  return { ...commonTrackInput(input), stage: explore };
}

function stateDirText(seed: Seed): string {
  return seed.stateDir ?? "<project>/.stelow/<date>/<dirHash>";
}

function buildWorkflowPrompt(input: PromptInput): string {
  // One parameterized builder: the shared prefix comes from the single
  // buildWorkflowPrompt so spawn, restart, and reseed open byte-identically.
  // Everything below differs per card, so it comes last: the cacheable region
  // is everything before this point.
  const card = [
    `This worker was re-seeded. Your state dir is (${stateDirText(input.seed)}) — its state.md holds name, intent, `
      + `current_stage, status. Use \`bb stelow advance <stage>\` to change stages `
      + "(do NOT hand-edit current_stage).",
    `Intent is currently \`${input.intent}\` in the re-seeded state.md. ${intentClause(input.intent)}`,
    workOrderClause(),
    presetInstructions(input.params.instructions),
    `Request:\n${input.card.prompt}`,
  ].join("\n\n");
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
  return buildSharedWorkflowPrompt(protocols, card);
}

function intentClause(intent: string): string {
  if (intent !== "unknown") return "Use it — do NOT ask the user to pick or confirm intent again.";
  return (
    "It is still unknown, so your FIRST job is triage: classify it " +
    "(new-product, feature, bugfix, refactor, or investigate), write it to " +
    "state.md immediately, and only then continue — ask via the form below " +
    "only if genuinely ambiguous."
  );
}

function workOrderClause(): string {
  return [
    "Order of work, always: (1) settle intent; (2) load the workflow skills; (3) advance stages and do the work.",
  ].join(" ");
}


function presetInstructions(instructions?: string): string {
  return instructions ? `Preset instructions:\n${instructions}\n` : "";
}
