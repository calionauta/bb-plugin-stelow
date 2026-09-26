/**
 * The CLI entry point. Same four beats as the card action, with two differences
 * the terminal forces: a dry run must mutate nothing at all — not the card, not
 * the scopes, not the preset — and a stage named with no card to advance is a
 * project-level helper run, which is legitimate and says so in its exit code.
 */
import type { AdvanceDeps, CliContext, CliResult, PreparedAdvance } from "./execution-advance-types.js";
import type { AdvanceServices } from "./execution-advance-card.js";

type CliAdvanceDeps = Pick<
  AdvanceDeps,
  | "getCardByWorkerThread"
  | "cardWorkspace"
  | "projectRoot"
  | "stateDir"
  | "ensureArtifacts"
  | "questionGate"
  | "runHelper"
  | "updateCard"
  | "recordStageEvent"
  | "requestGatePreReview"
>;

const USAGE = "Usage: bb stelow advance [--project <proj_id>] [--dry-run] [--json] <stage>";

type ParsedCli = { projectId: string | null; dryRun: boolean; json: boolean; stage: string | undefined };

export function createCliAdvance(deps: CliAdvanceDeps, services: AdvanceServices) {
  return {
    advanceCli: (argv: string[], context: CliContext) => advanceCli(deps, services, argv, context),
  };
}

function parseCli(argv: string[], context: CliContext): ParsedCli {
  const args = argv.slice(1);
  const flag = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const projectId = flag("--project") ?? context.projectId ?? null;
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");
  const stage = flag("--stage") ?? args.find((arg) => !arg.startsWith("--") && arg !== projectId);
  return { projectId, dryRun, json, stage };
}

export async function advanceCli(
  deps: CliAdvanceDeps,
  services: AdvanceServices,
  argv: string[],
  context: CliContext,
): Promise<CliResult> {
  const parsed = parseCli(argv, context);
  if (!parsed.projectId || !parsed.stage) return { exitCode: 2, stderr: USAGE };
  const card = context.threadId ? deps.getCardByWorkerThread(context.threadId) : undefined;
  const workspace = card ? await deps.cardWorkspace(card) : null;
  const rootPath = workspace?.path ?? await deps.projectRoot(parsed.projectId);
  if (!rootPath) return { exitCode: 1, stderr: "Workspace path is unavailable." };
  const stateDir = card?.dir_hash ? await deps.stateDir(card, rootPath) : null;
  const guard = await deps.ensureArtifacts(rootPath, stateDir, Boolean(card?.dir_hash));
  if (guard) return { exitCode: 1, stderr: guard };
  if (!parsed.dryRun && card) {
    const questionGuard = await deps.questionGate(card, stateDir);
    if (questionGuard) return { exitCode: 1, stderr: questionGuard };
  }
  const prepared = card
    ? await services.prepareAdvance({
      card,
      stage: parsed.stage,
      rootPath,
      stateDir,
      dryRun: parsed.dryRun,
      includeRework: true,
    })
    : { route: null, note: "", evidence: "" };
  if ("error" in prepared) return { exitCode: 1, stderr: prepared.error };
  return runAdvance(deps, services, parsed, parsed.stage, card, rootPath, stateDir, prepared);
}

async function runAdvance(
  deps: CliAdvanceDeps,
  services: AdvanceServices,
  parsed: ParsedCli,
  stage: string,
  card: ReturnType<CliAdvanceDeps["getCardByWorkerThread"]>,
  rootPath: string,
  stateDir: string | null,
  prepared: PreparedAdvance,
): Promise<CliResult> {
  const result = await deps.runHelper(helperArgs(stage, parsed), rootPath, stateDir ?? undefined);
  if (result.code !== 0) {
    return { exitCode: result.code ?? 1, stderr: result.stderr || "advance failed", stdout: result.stdout };
  }
  if (parsed.dryRun || !card) return { exitCode: 0, stdout: result.stdout };
  await services.applyBand(card, stage, true);
  deps.updateCard(card.id, { stage, status: "in-progress", activity: "running", last_error: null });
  deps.recordStageEvent(card.id, stage);
  const dispatched = await services.dispatchAdvance({
    card, stage, route: prepared.route, note: prepared.note, evidence: prepared.evidence,
  });
  void deps.requestGatePreReview(card.id, stage).catch(() => undefined);
  return { exitCode: 0, stdout: result.stdout + dispatched.stdout };
}

function helperArgs(stage: string, parsed: ParsedCli): string[] {
  return [
    "advance",
    stage,
    ...(parsed.dryRun ? ["--dry-run"] : []),
    ...(parsed.json ? ["--json"] : []),
  ];
}
