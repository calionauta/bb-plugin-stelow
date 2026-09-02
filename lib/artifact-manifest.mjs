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
