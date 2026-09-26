import { execFile } from "node:child_process";
import { isDoneStatus } from "../../../lib/trackables.mjs";
import { ERR_WORKSPACE_UNAVAILABLE, noCardInContext, scanCardId, unknownCard, type CliCommandFn, type CliResult } from "./cli-contract.js";
import {
  decisionApiEnabled,
  judgingPoint,
  judgingRoute,
  PRESET_NEEDS_JUDGE,
} from "./cli-judging-route.js";
import {
  TASK_EVIDENCE_DIFF_CHARS,
  resolveScopeVerdicts,
  taskVerifyCommand,
  tasksToScoreQuestions,
} from "../../../lib/task-evidence.mjs";
import { loadCardScopes } from "../../scopes.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow verify-tasks [--card <card_id>] [--json]";
const MODE_REFUSAL =
  "Task evidence needs the Artifact criteria router in Decision API or preset mode. Set it in Manage agent presets → Decision routers.";

type DoneTask = {
  id: string;
  name: string;
  scope: string;
  verify: string | null;
};

type TaskFinding = {
  id: string;
  name: string;
  score: number | null;
  confidence: number | null;
  verdict: string;
  error: string | null;
  source: "command" | "judge";
};

type TaskRoute = {
  mode: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  routeAt: number;
  presetId: string | null;
};

/** Advisory task-evidence check: completed statuses are worker assertions —
 * this asks a judge, per task, whether the working diff shows evidence, through
 * the artifact-criteria point (rules reports everything unverifiable without
 * calling out). Read-only, never a gate: findings guide the worker, done
 * decides separately. */
export function createVerifyTasksCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "verify-tasks") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    return runVerifyTasks(deps, card, json);
  };
}

async function runVerifyTasks(
  deps: CliDeps,
  card: WorkerCard,
  json: boolean,
): Promise<CliResult> {
  const disabled = decisionApiEnabled();
  if (disabled) return disabled;
  const point = judgingPoint(deps, MODE_REFUSAL);
  if ("refusal" in point) return point.refusal;
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path)
    return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
  const scopes = loadCardScopes(workspace.path, card.id);
  const doneTasks = completedTasks(scopes);
  if (doneTasks.length === 0)
    return {
      exitCode: 0,
      stdout:
        "No completed tasks to evidence — pending tasks are openly pending, nothing to judge.",
    };
  const route = judgingRoute(deps, point.point, point.mode);
  if ("refusal" in route) return route.refusal;
  const diff = await deps.workingDiffFor(workspace.path, TASK_EVIDENCE_DIFF_CHARS);
  const findings = await judgeTasks(deps, card, workspace.path, doneTasks, diff, route);
  if ("error" in findings) return { exitCode: 1, stderr: findings.error };
  return taskResult(card.id, route, findings, scopes, json);
}

function completedTasks(
  scopes: ReturnType<typeof loadCardScopes>,
): DoneTask[] {
  return scopes.flatMap((scope) =>
    (Array.isArray(scope.tasks) ? scope.tasks : [])
      .filter((task) => isDoneStatus(task.status))
      .map((task) => ({
        id: task.id,
        name: task.name,
        scope: scope.name,
        verify: taskVerifyCommand(task),
      })),
  );
}

/** Deterministic findings first, judged after — both in doneTasks order
 * inside their group. Tasks carrying their own verify command run
 * deterministically (authoritative, zero judge cost); the rest go to the
 * judge. Everything verified deterministically needs no judge at all, so no
 * preset or key is required for that card. */
async function judgeTasks(
  deps: CliDeps,
  card: WorkerCard,
  workspacePath: string,
  doneTasks: DoneTask[],
  diff: string,
  route: TaskRoute,
): Promise<TaskFinding[] | { error: string }> {
  const commandFindings = await runCommandTasks(
    doneTasks.filter((task) => task.verify !== null),
    workspacePath,
  );
  const judgedTasks = doneTasks.filter((task) => task.verify === null);
  if (judgedTasks.length === 0) return commandFindings;
  if (route.mode === "preset" && !route.presetId)
    return { error: PRESET_NEEDS_JUDGE };
  const judged = await deps.judgeScoredBatch({
    items: judgedTasks.map((task) => ({
      id: task.id,
      text: `${task.name} (scope: ${task.scope})`,
    })),
    questions: tasksToScoreQuestions(doneTasks) as Record<string, unknown>,
    keyPrefix: "task",
    state: diff,
    mode: route.mode,
    presetId: route.presetId,
    projectId: card.project_id,
    title: "Stelow judge: task evidence",
    provider: route.provider,
    endpoint: route.endpoint,
    apiKey: route.apiKey,
    model: route.model,
    routeAt: route.routeAt,
  });
  if (!judged.ok)
    return {
      error: `Task judging failed: ${judged.error} — retry or check the router.`,
    };
  return [
    ...commandFindings,
    ...judged.findings.map((finding) => ({
      ...finding,
      source: "judge" as const,
    })),
  ];
}

/** Checkout-pinned via execFile, no shell — the worker already owns a shell,
 * so this grants no new privilege. Exit 0 reads met, any other exit reads
 * unmet, spawn/timeout failures read unverifiable with the reason. */
async function runCommandTasks(
  tasks: DoneTask[],
  cwd: string,
): Promise<TaskFinding[]> {
  return Promise.all(
    tasks.map(async (task) => {
      const ran = await runVerifyCommand(task.verify as string, cwd).catch(() => ({
        ok: false,
        code: null as number | null,
        failed: true,
      }));
      const base = { id: task.id, name: task.name, source: "command" as const };
      if (ran.failed)
        return {
          ...base,
          score: null,
          confidence: null,
          verdict: "unverifiable",
          error: "verify command did not run",
        };
      return {
        ...base,
        score: ran.ok ? 2 : 0,
        confidence: 1,
        verdict: ran.ok ? "met" : "unmet",
        error: null as string | null,
      };
    }),
  );
}

function runVerifyCommand(
  cmd: string,
  cwd: string,
): Promise<{ ok: boolean; code: number | null; failed: boolean }> {
  return new Promise((resolveRun) => {
    const [bin, ...rest] = cmd.split(/\s+/);
    execFile(
      bin,
      rest,
      { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout) => {
        const code = (error as { code?: unknown } | null)?.code;
        if (error && typeof code !== "number")
          return resolveRun({ ok: false, code: null, failed: true });
        const exitCode = typeof code === "number" ? code : 0;
        resolveRun({ ok: exitCode === 0, code: exitCode, failed: false });
      },
    );
  });
}

function taskResult(
  cardId: string,
  route: TaskRoute,
  findings: TaskFinding[],
  scopes: ReturnType<typeof loadCardScopes>,
  json: boolean,
): CliResult {
  const met = findings.filter((finding) => finding.verdict === "met").length;
  const unmet = findings.filter((finding) => finding.verdict === "unmet").length;
  const unverifiable = findings.length - met - unmet;
  // Scope rollup is deterministic, never judged: a done scope reads from its
  // tasks' verdicts, so scopes cost zero extra calls.
  const scopeRollup = resolveScopeVerdicts({ scopes, taskFindings: findings });
  if (json)
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          card: cardId,
          provider: route.provider,
          findings,
          scopes: scopeRollup,
          summary: { met, unmet, unverifiable },
        },
        null,
        2,
      ),
    };
  return {
    exitCode: 0,
    stdout: [
      `Task evidence (${findings.length} completed tasks judged against the working diff):`,
      ...findings.map(taskLine),
      `Scopes (deterministic rollup, no extra calls):`,
      ...scopeRollup.map(
        (scope) =>
          `${verdictMark(scope.verdict)} ${scope.name} — ${scope.verdict} (${scope.detail})`,
      ),
      `Summary: ${met} met, ${unmet} unmet, ${unverifiable} unverifiable — advisory only, never blocking.`,
    ].join("\n"),
  };
}

function taskLine(finding: TaskFinding): string {
  const evidence =
    finding.source === "command"
      ? " (verified)"
      : finding.confidence !== null
        ? ` (confidence ${finding.confidence})`
        : "";
  return `${verdictMark(finding.verdict)} ${finding.name} — ${finding.verdict}${evidence}`;
}

function verdictMark(verdict: string): string {
  return verdict === "met" ? "✓" : verdict === "unmet" ? "✗" : "?";
}
