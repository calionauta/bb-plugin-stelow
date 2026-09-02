import { isAbsolute, relative, resolve, sep } from "node:path";

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
    if (item) {
      if (current?.stage && current.path) artifacts.push(current);
      current = { [item[1]]: item[2].trim() };
    } else if (field && current) {
      current[field[1]] = field[2].trim();
    }
  }
  if (current?.stage && current.path) artifacts.push(current);
  return artifacts;
}
