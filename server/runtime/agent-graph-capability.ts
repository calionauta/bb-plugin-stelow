/**
 * The Agent Graph capability: can this host show a live node graph of a
 * card's worker thread?
 *
 * A live graph is not a Stelow setting — it is another host plugin. So the
 * card cannot fix a missing one, and the honest move is to say so where the
 * person can act (the About tab) and never install anything behind their
 * back: unlike the Workflows dependency, this capability offers no install
 * or enable action at all, only a pointer to BB Extensions. A plugin install
 * changes the host, not this card.
 *
 * The status is a decision over `bb plugin list --json`, so the decision is
 * a pure function and the subprocess is injected: a test drives the verdict
 * with a recorded CLI response and never spawns anything.
 */

export type AgentGraphCapabilityStatus = {
  id: "agent-graph";
  name: "Agent Graph";
  installed: boolean;
  enabled: boolean;
  running: boolean;
  available: boolean;
  version: string | null;
  detail: string;
};

export type AgentGraphCliResult = { code: number; stdout: string; stderr: string };

export type AgentGraphCapabilityDeps = {
  runBbCli: (args: string[]) => Promise<AgentGraphCliResult>;
};

const UNREADABLE: AgentGraphCapabilityStatus = {
  id: "agent-graph",
  name: "Agent Graph",
  installed: false,
  enabled: false,
  running: false,
  available: false,
  version: null,
  detail: "The host did not answer the plugin probe, so the live-graph action stays hidden.",
};

/** What the person is told next, decided by the state they are actually in. */
function detailFor(installed: boolean, enabled: boolean, running: boolean): string {
  if (!installed) return "Install Agent Graph from BB Extensions to watch a card's agent as a live node graph.";
  if (!enabled) return "Enable Agent Graph in BB Extensions to watch a card's agent as a live node graph.";
  return running
    ? "Agent Graph is installed, enabled, and running."
    : "Agent Graph is installed and enabled; the host is still starting it.";
}

function pluginRows(stdout: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(stdout) as { plugins?: unknown[] } | unknown[];
    const plugins = Array.isArray(parsed) ? parsed : parsed.plugins;
    if (!Array.isArray(plugins)) return null;
    return plugins.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object",
    );
  } catch {
    return null;
  }
}

/** The verdict, from one `bb plugin list --json` answer. */
export function readAgentGraphCapabilityStatus(result: AgentGraphCliResult): AgentGraphCapabilityStatus {
  if (result.code !== 0) {
    return { ...UNREADABLE, detail: result.stderr.trim() || UNREADABLE.detail };
  }
  // A readable answer is parsed JSON; anything else is a broken probe, and a
  // broken probe must not look like "not installed".
  const rows = pluginRows(result.stdout);
  if (rows === null) return { ...UNREADABLE };
  const row = rows.find((entry) => entry.id === "agent-graph") ?? null;
  if (row === null) {
    return {
      id: "agent-graph",
      name: "Agent Graph",
      installed: false,
      enabled: false,
      running: false,
      available: false,
      version: null,
      detail: detailFor(false, false, false),
    };
  }
  const installed = true;
  const enabled = row.enabled === true;
  const running = row.status === "running";
  return {
    id: "agent-graph",
    name: "Agent Graph",
    installed,
    enabled,
    running,
    available: enabled && running,
    version: typeof row.version === "string" ? row.version : null,
    detail: detailFor(installed, enabled, running),
  };
}

export function createAgentGraphCapabilityHandlers(deps: AgentGraphCapabilityDeps) {
  const status = async () => readAgentGraphCapabilityStatus(await deps.runBbCli(["plugin", "list", "--json"]));
  return { agentGraphStatus: status };
}
