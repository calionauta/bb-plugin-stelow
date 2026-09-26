const WORKFLOWS_ID = "workflows";
const WORKFLOWS_NAME = "BB Workflows";
const UNREADABLE_DETAIL = "BB Workflows status could not be read.";

function pluginRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed?.plugins) ? parsed.plugins : [];
}

function workflowsRow(stdout) {
  const rows = pluginRows(JSON.parse(stdout));
  return rows.find(
    (entry) => Boolean(entry) && typeof entry === "object" && entry.id === WORKFLOWS_ID,
  ) ?? null;
}

function readinessDetail(installed, enabled, running) {
  if (!installed) return `Install ${WORKFLOWS_NAME} to unlock durable native execution.`;
  if (!enabled) return `Enable ${WORKFLOWS_NAME} to unlock durable native execution.`;
  if (running) return `${WORKFLOWS_NAME} is installed, enabled, and ready.`;
  return `${WORKFLOWS_NAME} is installed and enabled; the host is still starting it.`;
}

function status({ installed, enabled, running, version }) {
  return {
    id: WORKFLOWS_ID,
    name: WORKFLOWS_NAME,
    installed,
    enabled,
    running,
    available: enabled && running,
    version,
    action: !installed ? "install" : !enabled ? "enable" : null,
    detail: readinessDetail(installed, enabled, running),
  };
}

/** The status shown when the host cannot be read at all. */
export function workflowsUnreadable(detail = UNREADABLE_DETAIL) {
  return {
    ...status({ installed: false, enabled: false, running: false, version: null }),
    detail: detail || UNREADABLE_DETAIL,
  };
}

/** Derive the dependency status from `bb plugin list --json` output. */
export function workflowsDependencyStatus(stdout) {
  const row = workflowsRow(stdout);
  if (!row) return status({ installed: false, enabled: false, running: false, version: null });
  return status({
    installed: true,
    enabled: row.enabled === true,
    running: row.status === "running",
    version: typeof row.version === "string" ? row.version : null,
  });
}
