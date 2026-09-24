const CARD_KINDS = new Set(["build", "research", "explore"]);

export function workspaceDirectivePath(value) {
  if (typeof value !== "string") return null;
  const rawPath = value.trim();
  if (rawPath.includes("\0") || /^(?:\/|\\|[A-Za-z]:|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(rawPath)) return null;
  const segments = rawPath.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) return null;
  const path = segments.filter((segment) => segment && segment !== ".").join("/");
  if (!path) return null;
  return path;
}

export function artifactDirectiveView(attributes) {
  const safeAttributes = attributes && typeof attributes === "object" ? attributes : {};
  const path = workspaceDirectivePath(safeAttributes.path);
  if (!path) return { kind: "invalid" };
  const requestedDisplay = typeof safeAttributes.display === "string"
    ? attributes.display.trim()
    : "";
  const basename = path.split(/[\\/]/).pop();
  return {
    kind: "ready",
    path,
    display: requestedDisplay || basename || "artifact",
  };
}

export function attemptWorkspaceFileOpen(openWorkspaceFile, path) {
  if (!openWorkspaceFile) return "unavailable";
  try {
    return openWorkspaceFile(path) ? "opened" : "dead";
  } catch {
    return "failed";
  }
}

export function normalizeOpenCardTarget(result) {
  if (typeof result?.cardId !== "string" || !/^card_[A-Za-z0-9]+$/.test(result.cardId)) return null;
  const kind = CARD_KINDS.has(result.kind) ? result.kind : "build";
  return { cardId: result.cardId, kind };
}

export function openCardTargetForThread(loaded, threadId) {
  return loaded?.threadId === threadId ? loaded.target : null;
}
