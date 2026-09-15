import { isAbsolute, relative, resolve, sep } from "node:path";

const ARTIFACT_FIELDS = new Set(["stage", "kind", "label", "path"]);

/**
 * Resolve only a manifest path that is explicitly relative to the project.
 * Artifact manifests are agent-produced input, so never let them name an
 * absolute file or traverse out of the workspace.
 */
export function resolveArtifactPath(projectRoot, artifactPath) {
  if (typeof projectRoot !== "string" || typeof artifactPath !== "string" || !artifactPath.trim()) return null;
  if (isAbsolute(artifactPath)) return null;
  if (artifactPath.split(/[\\/]+/).some((segment) => segment === "..")) return null;
  try {
    const root = resolve(projectRoot);
    const fullPath = resolve(root, artifactPath);
    const fromRoot = relative(root, fullPath);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
    return fullPath;
  } catch {
    return null;
  }
}

/**
 * Documents the workflow wrote but never registered in state.md.
 *
 * The audit trail must not depend on an agent remembering to declare its own
 * output: a produced artifact that was never registered would otherwise be
 * invisible on the card. `.md` is the same bar the board's `findArtifacts`
 * uses, so the card and the board agree on what counts as a document; the
 * workflow's own state is bookkeeping, not an artifact.
 */
const STATE_BOOKKEEPING = /^state\.md(\.bak|$)/;

export function unregisteredArtifactPaths(allPaths, registeredPaths) {
  const registered = new Set(Array.isArray(registeredPaths) ? registeredPaths.filter((path) => typeof path === "string") : []);
  const seen = new Set();
  const result = [];
  for (const candidate of Array.isArray(allPaths) ? allPaths : []) {
    if (typeof candidate !== "string" || !candidate) continue;
    const name = candidate.replace(/\\/g, "/").split("/").pop() ?? "";
    if (!name.endsWith(".md") || STATE_BOOKKEEPING.test(name)) continue;
    if (registered.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

export function parseArtifactManifest(stateBlob) {
  const lines = String(stateBlob).split("\n");
  const start = lines.findIndex((line) => line === "artifacts:");
  if (start < 0) return [];

  const artifacts = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const item = line.match(/^  - ([a-z_]+):\s*(.+)$/);
    const field = line.match(/^    ([a-z_]+):\s*(.+)$/);
    if (item && ARTIFACT_FIELDS.has(item[1])) {
      if (current?.stage && current.path) artifacts.push(current);
      current = { [item[1]]: item[2].trim() };
    } else if (field && current && ARTIFACT_FIELDS.has(field[1])) {
      current[field[1]] = field[2].trim();
    }
  }
  if (current?.stage && current.path) artifacts.push(current);
  return artifacts;
}
