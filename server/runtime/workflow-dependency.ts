/**
 * The BB Workflows dependency: can this host run a native workflow at all?
 *
 * Durable native execution is not a Stelow setting — it is another host plugin.
 * So the card cannot fix a missing one, and the honest move is to say so where
 * the person can act (the About tab) and offer the one action that helps: install
 * or enable BB Workflows, on explicit request only. The plugin is never installed
 * behind someone's back, because a plugin install changes the host, not this
 * card.
 *
 * The status is a decision over `bb plugin list --json`, so the decision is a
 * pure function and the subprocess is injected: a test drives the verdict with a
 * recorded CLI response and never spawns anything.
 */
import { execFile } from "node:child_process";

export type WorkflowDependencyStatus = {
  id: "workflows";
  name: "BB Workflows";
  installed: boolean;
  enabled: boolean;
  running: boolean;
  available: boolean;
  version: string | null;
  action: "install" | "enable" | null;
  detail: string;
};

export type BbCliResult = { code: number; stdout: string; stderr: string };

export type WorkflowDependencyDeps = {
  runBbCli: (args: string[]) => Promise<BbCliResult>;
};

const READ_FAILURE: WorkflowDependencyStatus = {
  id: "workflows",
  name: "BB Workflows",
  installed: false,
  enabled: false,
  running: false,
  available: false,
  version: null,
  action: "install",
  detail: "BB Workflows status could not be read.",
};

function unavailable(detail: string): WorkflowDependencyStatus {
  return { ...READ_FAILURE, detail };
}

/** What the person is told next, decided by the state they are actually in. */
function detailFor(installed: boolean, enabled: boolean, running: boolean): string {
  if (!installed) return "Install BB Workflows to unlock durable native execution.";
  if (!enabled) return "Enable BB Workflows to unlock durable native execution.";
  return running
    ? "BB Workflows is installed, enabled, and ready."
    : "BB Workflows is installed and enabled; the host is still starting it.";
}

function workflowRow(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout) as { plugins?: unknown[] } | unknown[];
    const plugins = Array.isArray(parsed) ? parsed : parsed.plugins;
    if (!Array.isArray(plugins)) return null;
    const row = plugins.find((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && (entry as { id?: unknown }).id === "workflows",
    );
    return row ?? null;
  } catch {
    return null;
  }
}

/** The verdict, from one `bb plugin list --json` answer. */
export function readWorkflowDependencyStatus(result: BbCliResult): WorkflowDependencyStatus {
  if (result.code !== 0) {
    return unavailable(result.stderr.trim() || READ_FAILURE.detail);
  }
  const row = workflowRow(result.stdout);
  if (row === null) {
    // A readable answer with no workflows row is a real state (not installed);
    // an unreadable one is a broken probe, and the two must not look alike.
    if (result.stdout.trim().length === 0) return unavailable(READ_FAILURE.detail);
  }
  const installed = row !== null;
  const enabled = row?.enabled === true;
  const running = row?.status === "running";
  return {
    id: "workflows",
    name: "BB Workflows",
    installed,
    enabled,
    running,
    available: enabled && running,
    version: typeof row?.version === "string" ? row.version : null,
    action: !installed ? "install" : !enabled ? "enable" : null,
    detail: detailFor(installed, enabled, running),
  };
}

export function createWorkflowDependencyHandlers(deps: WorkflowDependencyDeps) {
  const status = async () => readWorkflowDependencyStatus(await deps.runBbCli(["plugin", "list", "--json"]));
  const act = async (args: string[], okWhen: (s: WorkflowDependencyStatus) => boolean, failure: string) => {
    const result = await deps.runBbCli(args);
    const current = await status();
    return {
      ok: result.code === 0 && okWhen(current),
      error: result.code === 0 ? null : result.stderr.trim() || result.stdout.trim() || failure,
      status: current,
    };
  };
  return {
    workflowDependencyStatus: status,
    installWorkflowDependency: () =>
      act(["plugin", "install", "builtin:workflows", "--yes", "--json"], (s) => s.installed, "BB Workflows installation failed."),
    enableWorkflowDependency: () =>
      act(["plugin", "enable", "workflows", "--json"], (s) => s.enabled, "BB Workflows could not be enabled."),
  };
}

/**
 * The host CLI, in its own environment. The tool-installer runner isolates
 * HOME on purpose; the bb CLI must NOT be isolated, because its own config
 * lives in HOME and an isolated run would report "not installed" forever.
 */
export function runHostBbCli(args: string[]): Promise<BbCliResult> {
  const bbCli = process.env.BB_CLI || "bb";
  return new Promise((resolve) => {
    execFile(bbCli, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error ? 1 : 0,
        stdout: typeof stdout === "string" ? stdout : "",
        stderr: typeof stderr === "string" ? stderr : "",
      });
    });
  });
}
