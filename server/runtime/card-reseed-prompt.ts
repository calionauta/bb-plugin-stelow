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
    inputContractClause(protocols.interfacePick),
    protocols.doneProtocol,
    protocols.splitProtocol,
    presetInstructions(input.params.instructions),
    `Request:\n${input.card.prompt}`,
  ].join("\n\n");
  return `${intro}\n\n${work}`;
}

function workflowSkillsClause(): string {
  return [
    "The Stelow workflow skills (stelow-workflow-entry, stelow-workflow-router, " +
      "stelow-workflow-*) are provided by this plugin — start by loading them " +
      "(they live under the plugin's skills directory; `bb skill list` shows them).",
    "The product strategy playbooks (stelow-product-*) are also provided by this " +
      "plugin — check `bb skill list` first, and only fetch via " +
      "`npx skills add calionauta/stelow` if one is missing.",
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

function inputContractClause(interfacePick: string): string {
  return [
    "CRITICAL — User input contract:",
    "ANY time you need user input, you MUST call the structured form:",
    "",
    "    bb stelow ask --thread \"$BB_THREAD_ID\" \\",
    "      --question \"<a single clear question>\" \\",
    "      --option \"<label 1>\" --option \"<label 2>\" [--option \"<label 3>\" ...] [--multiple]",
    "",
    "Batch independent questions into ONE ask call by repeating --question groups " +
      "(each with its own --option labels). Ask dependent questions (where Q2 " +
      "needs Q1's answer) one at a time.",
    "When the human must compare artifacts to decide (interface picks, plan reviews), " +
      "attach each option's evidence: --desc for trade-offs, --preview for the " +
      "inline glance, --artifact for the workspace-relative file they can open.",
    "",
    "Before asking a question, first summarize what you read (files, plan, codebase) " +
      "so the user can answer with context — never dump a raw file list as the only " +
      "content of a question. Do not skip the triage stage.",
    "Each bb stelow ask call blocks until the user submits; the card stays in its " +
      "column and signals it is waiting for an answer.",
    "If an ask returns \"No response after Ns\" (timeout), STOP and wait: do NOT " +
      "proceed with the workflow. The question stays pending on the card and remains " +
      "answerable; when the user answers it on the card, the answer is delivered to " +
      "you as a message and you continue from there. Never re-ask the same question " +
      "— wait for the card answer.",
    interfacePick,
  ].join("\n");
}

function presetInstructions(instructions?: string): string {
  return instructions ? `Preset instructions:\n${instructions}\n` : "";
}
