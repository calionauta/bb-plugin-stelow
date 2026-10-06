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
  const protocols = input.protocols;
  const intro = [
    "You are running a Stelow workflow inside the bb-plugin-stelow panel.",
    "The host re-seeded your per-workflow state, transitions.md, and stelow.json.",
    `Your workflow owns its own state dir (${stateDirText(input.seed)}) — its state.md holds name, intent, current_stage, status.`,
    protocols.cardOwnerRules,
    workflowSkillsClause(),
    `Use \`bb stelow advance <stage>\` to change stages (do NOT hand-edit current_stage). ${protocols.neverSeed}`,
    "Preserve every gate (product, interface, tech plan, diff).",
    protocols.cliEquivalents,
    protocols.reconProtocol,
    protocols.draftProtocol,
  ].join(" ");
  const work = [
    protocols.turnDiscipline,
    protocols.commitStyle,
    `Intent is currently \`${input.intent}\` in the re-seeded state.md. ${intentClause(input.intent)}`,
    workOrderClause(),
    inputContractClause(protocols.interfacePick, protocols.userInputContract),
    protocols.doneProtocol,
    protocols.splitProtocol,
    presetInstructions(input.params.instructions),
    `Request:\n${input.card.prompt}`,
  ].join("\n\n");
  return `${intro}\n\n${work}`;
}

function workflowSkillsClause(): string {
  return [
    "Read `bb stelow playbook` and load exactly the skills it names, in the order it lists them —",
    "it is the whole reading list for the re-seeded stage and it resolves the plugin's skill paths.",
    "Do not search for skills, do not load a stage skill you have not reached, and do not fetch",
    "anything via `npx skills add` unless the playbook reports a path missing.",
  ].join(" ");
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
    "If a `bb stelow` command fails, read its stderr once and continue — do NOT spend the turn debugging the CLI; report the exact error and move on.",
  ].join(" ");
}

function inputContractClause(interfacePick: string, userInputContract: string): string {
  return [userInputContract, interfacePick].join("\n\n");
}

function presetInstructions(instructions?: string): string {
  return instructions ? `Preset instructions:\n${instructions}\n` : "";
}
