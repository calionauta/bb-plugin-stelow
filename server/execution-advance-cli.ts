/**
 * The CLI entry point. Same four beats as the card action, with two differences
 * the terminal forces: a dry run must mutate nothing at all — not the card, not
 * the scopes, not the preset — and a stage named with no card to advance is a
 * project-level helper run, which is legitimate and says so in its exit code.
 *
 * Fail-closed like the card action: archived, no-stage kinds, and the question
 * gate are all enforced even on --dry-run. The probe that asks "may I advance?"
 * must report the same refusal the real advance would, or it teaches the worker
 * a yes the real path refuses. Kind and status facts come from the card-action
 * module (noStageKindRefusal/commitStage) so the two paths cannot disagree.
 */
import type { AdvanceDeps, CliContext, CliResult, PreparedAdvance } from "./execution-advance-types.js";
import {
  commitStage,
  noStageKindRefusal,
  type AdvanceServices,
} from "./execution-advance-card.js";

type CliAdvanceDeps = Pick<
  AdvanceDeps,
  | "errors"
  | "isArchivedCard"
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
import { workspaceUnavailable } from "../lib/workspace-refusal.mjs";
import { findSingleLegacyStateDir } from "./runtime/workflow-state.js";

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
  if (card) {
    if (deps.isArchivedCard(card)) return { exitCode: 1, stderr: deps.errors.cardArchived };
    const kindRefusal = noStageKindRefusal(card.kind);
    if (kindRefusal) return { exitCode: 1, stderr: kindRefusal };
  }
  const workspace = card ? await deps.cardWorkspace(card) : null;
  const rootPath = workspace?.path ?? await deps.projectRoot(parsed.projectId);
  if (!rootPath) return { exitCode: 1, stderr: workspaceUnavailable(USAGE) };
  const stateDir = card?.dir_hash ? await deps.stateDir(card, rootPath) : null;
  const legacy = !card && !stateDir ? findSingleLegacyStateDir(rootPath) : null;
  if (legacy?.kind === "ambiguous") {
    return {
      exitCode: 1,
      stderr: `${legacy.count} cardless workflows under .stelow — leave exactly one to advance it from the CLI.`,
    };
  }
  const resolvedStateDir = stateDir ?? (legacy?.kind === "single" ? legacy.stateDir : null);
  const guard = await deps.ensureArtifacts(rootPath, resolvedStateDir, Boolean(card?.dir_hash));
  if (guard) return { exitCode: 1, stderr: guard };
  if (card) {
    const questionGuard = await deps.questionGate(card, resolvedStateDir);
    if (questionGuard) return { exitCode: 1, stderr: questionGuard };
  }
  const prepared = card
    ? await services.prepareAdvance({
      card,
      stage: parsed.stage,
      rootPath,
      stateDir: resolvedStateDir,
      dryRun: parsed.dryRun,
      includeRework: true,
    })
    : { route: null, note: "", evidence: "" };
  if ("error" in prepared) return { exitCode: 1, stderr: prepared.error };
  return runAdvance(deps, services, parsed, parsed.stage, card, rootPath, resolvedStateDir, prepared);
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
  commitStage(deps, card.id, stage);
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
