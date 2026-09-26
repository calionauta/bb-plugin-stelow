/**
 * The BB Workflows dependency: is the host plugin installed, enabled, and
 * running, and can the user put it in that state from the About panel.
 *
 * The status is derived from `bb plugin list --json` by
 * `lib/workflow-dependency-status.mjs`; this module owns the process seam
 * and the three RPC handlers, so the derivation stays testable without a
 * host and the handler wiring stays testable without one too.
 */
import { execFile } from "node:child_process";
import {
  workflowsDependencyStatus,
  workflowsUnreadable,
  type WorkflowDependencyStatus,
} from "../../lib/workflow-dependency-status.mjs";

const bbCli = process.env.BB_CLI || "bb";
const CLI_TIMEOUT_MS = 30_000;

export type BbCliResult = { code: number; stdout: string; stderr: string };
export type RunBbCli = (args: string[]) => Promise<BbCliResult>;
export type WorkflowDependencyHandlers = {
  workflowDependencyStatus: () => Promise<WorkflowDependencyStatus>;
  installWorkflowDependency: () => Promise<ConfigurationOutcome>;
  enableWorkflowDependency: () => Promise<ConfigurationOutcome>;
};

export type ConfigurationOutcome = {
  ok: boolean;
  error: string | null;
  status: WorkflowDependencyStatus;
};

export type WorkflowDependencyDeps = { runCli?: RunBbCli };

/** Run the host CLI, never throwing: a failed call is a refusal to read. */
export function runBbCli(args: string[]): Promise<BbCliResult> {
  return new Promise((resolve) => {
    execFile(bbCli, args, { timeout: CLI_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error ? 1 : 0,
        stdout: typeof stdout === "string" ? stdout : "",
        stderr: typeof stderr === "string" ? stderr : "",
      });
    });
  });
}

async function readWorkflowDependencyStatus(runCli: RunBbCli): Promise<WorkflowDependencyStatus> {
  const result = await runCli(["plugin", "list", "--json"]);
  if (result.code !== 0) return workflowsUnreadable(result.stderr.trim());
  try {
    return workflowsDependencyStatus(result.stdout);
  } catch (error) {
    return workflowsUnreadable(error instanceof Error ? error.message : "");
  }
}

async function configureDependency(
  runCli: RunBbCli,
  args: string[],
  settled: "installed" | "enabled",
  failure: string,
): Promise<ConfigurationOutcome> {
  const result = await runCli(args);
  const status = await readWorkflowDependencyStatus(runCli);
  return {
    ok: result.code === 0 && status[settled],
    error: result.code === 0
      ? null
      : result.stderr.trim() || result.stdout.trim() || failure,
    status,
  };
}

export function createWorkflowDependencyHandlers(
  deps: WorkflowDependencyDeps = {},
): WorkflowDependencyHandlers {
  const runCli = deps.runCli ?? runBbCli;
  return {
    workflowDependencyStatus: () => readWorkflowDependencyStatus(runCli),
    installWorkflowDependency: () =>
      configureDependency(runCli, ["plugin", "install", "builtin:workflows", "--yes", "--json"], "installed", "BB Workflows installation failed."),
    enableWorkflowDependency: () =>
      configureDependency(runCli, ["plugin", "enable", "workflows", "--json"], "enabled", "BB Workflows could not be enabled."),
  };
}
