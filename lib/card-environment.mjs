/**
 * Worker environment resolution with honest fallback (pure, no I/O).
 *
 * The BB composer owns environment selection; the preset is only a
 * fallback. A fallback that swallows an explicit worktree choice leaves
 * the worker in the wrong checkout with no signal — exactly the
 * "I picked worktree but nothing happened" shape. So selection stays
 * total (never throws, never blocks creation) but any substitution of an
 * explicitly requested environment produces a notice naming asked vs
 * used, and the host surfaces it (log + card comment) instead of
 * proceeding silently.
 */

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolve the requested environment or fall back. Accepted shapes pass
 * through by reference (callers test identity); anything else resolves
 * to the fallback.
 */
export function selectCardEnvironment(requested, fallback) {
  if (!isObject(requested)) return fallback;
  if (requested.type === "project-default") return requested;
  if (requested.type === "reuse" && typeof requested.environmentId === "string") return requested;
  if (requested.type !== "host" || !isObject(requested.workspace)) return fallback;
  const workspace = requested.workspace;
  if (workspace.type === "unmanaged" || workspace.type === "managed-worktree" || workspace.type === "personal") return requested;
  return fallback;
}

export function isManagedWorktreeEnvironment(value) {
  if (!isObject(value) || !("type" in value) || value.type !== "host" || !("workspace" in value)) return false;
  return isObject(value.workspace) && value.workspace.type === "managed-worktree";
}

function describeRequested(requested) {
  if (!isObject(requested)) return "nothing (default applies)";
  const type = typeof requested.type === "string" ? requested.type : "unknown shape";
  if (isObject(requested.workspace) && typeof requested.workspace.type === "string") {
    return `${type} with ${requested.workspace.type} workspace`;
  }
  if (typeof requested.environmentId === "string") return `${type} (${requested.environmentId})`;
  return type;
}

function describeSelected(selected) {
  if (!isObject(selected)) return "unknown";
  if (selected.type === "project-default") return "the project checkout";
  if (selected.type === "reuse") return "the reused environment";
  if (isManagedWorktreeEnvironment(selected)) return "a managed worktree";
  if (isObject(selected.workspace) && typeof selected.workspace.path === "string" && selected.workspace.path) {
    return selected.workspace.path;
  }
  return selected.type || "unknown";
}

/**
 * Notice when an explicitly requested environment was substituted, or null
 * when nothing was asked or the request was honored (same reference).
 * Every notice names the redirect: re-pick, or assign a new-worktree
 * preset and restart the worker.
 */
export function environmentFallbackNotice(requested, selected) {
  if (!isObject(requested)) return null;
  if (requested === selected) return null;
  return `Worker environment request was not applied — asked ${describeRequested(requested)}, using ${describeSelected(selected)}. ` +
    `If you picked a worktree, re-pick it (or assign a new-worktree preset to this card) and restart the worker; ` +
    `work done in the wrong checkout is the failure this names.`;
}
