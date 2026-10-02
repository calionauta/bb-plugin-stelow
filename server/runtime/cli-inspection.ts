import { join } from "node:path";
import { existsSync } from "node:fs";
import { playbookEntries, renderPlaybook } from "../../lib/playbook.mjs";
import { renderStatusLine, type QuestionCount, type StatusBoardLine } from "../../lib/status-question-state.mjs";
import { isArchivedCard } from "../../lib/worker-action-policy.mjs";
import { OWNERSHIP_UNVERIFIED } from "../../lib/ownership-refusal.mjs";
import type { WorkerCard } from "../workers.js";
import type { CliResult, CliRunContext } from "./cli-dispatch.js";

type Board = {
  error?: string | null;
  workflows: StatusBoardLine[];
};

type HelperResult = {
  code?: number | null;
  stdout: string;
  stderr: string;
};

type InspectionDeps = {
  skillsDir: string;
  errors: { archived: string; workspace: string };
  getCard: (cardId: string) => WorkerCard | undefined;
  getCardForThread: (threadId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  loadBoard: (projectId: string | null) => Promise<Board>;
  boardFromRoot: (root: string, dirHash: string | null) => Promise<Board>;
  /**
   * Open question counts per card, so `status` answers "is anything waiting
   * on me?" without a worker having to ask a human to find out. A failed read
   * returns null and the line simply omits the count — an unknown is never
   * rendered as zero.
   */
  openQuestionsByCard: (cardIds: string[]) => Promise<Map<string, QuestionCount> | null>;
  projectRoot: (projectId: string | null) => Promise<string | null>;
  workflowStateDir: (
    root: string,
    cardId: string,
    dirHash: string,
  ) => Promise<string | null>;
  ensureProjectArtifacts: (
    root: string,
    stateDir: string | null,
    hasOwnedState: boolean,
  ) => Promise<string | null>;
  runHelper: (
    args: string[],
    root: string,
    stateDir?: string,
  ) => Promise<HelperResult>;
  readText: (path: string) => Promise<string | null>;
  researchStrategySkill: (id: string) => string | null;
  exploreTechnique: (id: string) => { skill: string; artifactFile: string } | null;
};

type InspectionCommand = (
  argv: string[],
  context: CliRunContext,
) => Promise<CliResult | null>;

const inspectionCommands = new Set(["status", "playbook", "doctor", "schema"]);

function cardFromArgs(
  argv: string[],
  context: CliRunContext,
  getCardForThread: InspectionDeps["getCardForThread"],
): { cardId?: string; error?: CliResult } {
  let cardId = context.threadId
    ? getCardForThread(context.threadId)?.id
    : undefined;
  const args = argv.slice(1);
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "--card") continue;
    cardId = args[index + 1];
    index++;
    continue;
  }
  return { cardId };
}

function rejectCardArgs(argv: string[], usage: string): CliResult | null {
  const args = argv.slice(1);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--card") {
      index++;
      continue;
    }
    return { exitCode: 2, stderr: usage };
  }
  return null;
}

function renderBoard(board: Board, json: boolean): CliResult {
  if (json) return { exitCode: 0, stdout: JSON.stringify(board, null, 2) };
  if (board.error) return { exitCode: 1, stderr: board.error };
  return {
    exitCode: 0,
    stdout: board.workflows.map((workflow) => renderStatusLine(workflow)).join("\n"),
  };
}

function statusCommand(
  argv: string[],
  context: CliRunContext,
  deps: InspectionDeps,
): Promise<CliResult> {
  const projectFlag = argv.indexOf("--project");
  const projectId = projectFlag >= 0 ? argv[projectFlag + 1] : context.projectId;
  const card = context.threadId
    ? deps.getCardForThread(context.threadId)
    : undefined;
  if (!card) return deps.loadBoard(projectId ?? null).then((board) => (
    renderBoard(board, argv.includes("--json"))
  ));
  return deps.cardWorkspace(card).then((workspace) => {
    if (!workspace?.path) {
      return {
        exitCode: 1,
        stderr: "Workspace path is unavailable for this card. Its checkout is not on "
          + "this host — open the card to see its environment, or run this from a card that has one.",
      };
    }
    return deps
      .boardFromRoot(workspace.path, card.dir_hash)
      .then((board) => withQuestionCounts(board, card, deps))
      .then((enriched) => renderBoard(enriched, argv.includes("--json")));
  });
}

/**
 * Attach this card's open question counts to the board it renders. A failed
 * read leaves the board untouched: an unknown count is never shown as zero,
 * because "0 open questions" is a claim that would stop a worker from asking
 * the one question it actually needed to ask.
 */
async function withQuestionCounts(
  board: Board,
  card: WorkerCard,
  deps: InspectionDeps,
): Promise<Board> {
  if (board.error || !board.workflows.length) return board;
  const counts = await deps.openQuestionsByCard([card.id]);
  if (!counts) return board;
  const questions = counts.get(card.id);
  if (!questions) return board;
  return {
    ...board,
    workflows: board.workflows.map((workflow) => ({ ...workflow, questions })),
  };
}

function playbookPaths(
  card: WorkerCard,
  stateDir: string | null,
  root: string,
  deps: InspectionDeps,
): { statePath: string; strategySkill: string | null; exploreSkill: string | null;
  researchIndexPath: string | null; exploreArtifactPath: string | null } {
  const statePath = stateDir ? join(stateDir, "state.md") : join(root, "state.md");
  const technique = card.kind === "explore"
    ? deps.exploreTechnique(card.explore_stage ?? "")
    : null;
  return {
    statePath,
    strategySkill: card.kind === "research"
      ? deps.researchStrategySkill(card.research_strategy ?? "")
      : null,
    exploreSkill: technique?.skill ?? null,
    researchIndexPath: card.kind === "research" && stateDir
      ? join(stateDir, "research-index.md")
      : null,
    exploreArtifactPath: stateDir && technique
      ? join(stateDir, technique.artifactFile)
      : null,
  };
}

function playbookResult(
  card: WorkerCard,
  stage: string,
  paths: ReturnType<typeof playbookPaths>,
  root: string,
  deps: InspectionDeps,
): CliResult {
  const entries = playbookEntries({
    kind: card.kind,
    stage,
    statePath: paths.statePath,
    transitionsPath: join(root, "skills/stelow-workflow-orchestrator/references/transitions.md"),
    skillsDir: deps.skillsDir,
    strategySkill: paths.strategySkill,
    exploreSkill: paths.exploreSkill,
    researchIndexPath: paths.researchIndexPath,
    exploreArtifactPath: paths.exploreArtifactPath,
  }, existsSync);
  return { exitCode: 0, stdout: renderPlaybook(entries) };
}

async function playbookCommand(
  argv: string[],
  context: CliRunContext,
  deps: InspectionDeps,
): Promise<CliResult> {
  const invalid = rejectCardArgs(argv, "Usage: bb stelow playbook [--card <card_id>]");
  if (invalid) return invalid;
  const { cardId } = cardFromArgs(argv, context, deps.getCardForThread);
  if (!cardId) return { exitCode: 2, stderr: "No card in context (run from the worker thread or pass --card <card_id>)." };
  const card = deps.getCard(cardId);
  if (!card) return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
  if (isArchivedCard(card)) return { exitCode: 1, stderr: deps.errors.archived };
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return { exitCode: 1, stderr: deps.errors.workspace };
  const stateDir = card.dir_hash
    ? await deps.workflowStateDir(workspace.path, card.id, card.dir_hash)
    : null;
  if (card.dir_hash && !stateDir) {
    return { exitCode: 1, stderr: OWNERSHIP_UNVERIFIED };
  }
  let stage = card.stage;
  const paths = playbookPaths(card, stateDir, workspace.path, deps);
  if (card.kind === "build") {
    const blob = await deps.readText(paths.statePath);
    stage = textStage(blob) || card.stage;
  }
  return playbookResult(card, stage, paths, workspace.path, deps);
}

function textStage(blob: string | null): string | null {
  return blob?.match(/current_stage:\s*(\S+)/m)?.[1] ?? null;
}

async function doctorCommand(
  argv: string[],
  context: CliRunContext,
  deps: InspectionDeps,
): Promise<CliResult> {
  const args = argv.slice(1);
  const projectId = args[args.indexOf("--project") + 1] ?? context.projectId;
  const stray = args.find((arg) => !arg.startsWith("--") && arg !== projectId);
  if (stray) return { exitCode: 2, stderr: "Usage: bb stelow doctor [--project <proj_id>] [--json]" };
  const card = context.threadId ? deps.getCardForThread(context.threadId) : undefined;
  const workspace = card ? await deps.cardWorkspace(card) : null;
  const root = workspace?.path ?? (await deps.projectRoot(projectId));
  // Names the fix. A refusal that only says what is missing is a refusal the
  // reader learns to work around: the command takes a project, and running it
  // outside a card thread leaves it with neither a card nor a project.
  if (!root) {
    return {
      exitCode: 1,
      stderr: "Workspace path is unavailable. Run this from the card's thread, or name the "
        + "project: bb stelow doctor --project <proj_id>.",
    };
  }
  const stateDir = card?.dir_hash
    ? await deps.workflowStateDir(root, card.id, card.dir_hash)
    : null;
  const guard = await deps.ensureProjectArtifacts(root, stateDir, Boolean(card?.dir_hash));
  if (guard) return { exitCode: 1, stderr: guard };
  const result = await deps.runHelper(
    args.includes("--json") ? ["doctor", "--json"] : ["doctor"],
    root,
    stateDir ?? undefined,
  );
  return result.code === 0
    ? { exitCode: 0, stdout: result.stdout }
    : { exitCode: result.code ?? 1, stderr: result.stderr || "doctor found drift", stdout: result.stdout };
}

async function schemaCommand(
  argv: string[],
  context: CliRunContext,
  deps: InspectionDeps,
): Promise<CliResult> {
  const sub = argv[1];
  if (sub?.startsWith("--")) return { exitCode: 2, stderr: "Usage: bb stelow schema [command]" };
  const root = await deps.projectRoot(context.projectId ?? null);
  if (!root) {
    return {
      exitCode: 1,
      stderr: "Workspace path is unavailable. Run this from the card's thread, or name the "
        + "project: bb stelow schema <command> --project <proj_id>.",
    };
  }
  const result = await deps.runHelper(sub ? ["schema", sub] : ["schema"], root);
  return { exitCode: result.code ?? 1, stdout: result.stdout, stderr: result.stderr };
}

export function createInspectionCommand(deps: InspectionDeps): InspectionCommand {
  return async (argv, context) => {
    if (!inspectionCommands.has(argv[0] ?? "")) return null;
    if (argv[0] === "status") return statusCommand(argv, context, deps);
    if (argv[0] === "playbook") return playbookCommand(argv, context, deps);
    if (argv[0] === "doctor") return doctorCommand(argv, context, deps);
    return schemaCommand(argv, context, deps);
  };
}
