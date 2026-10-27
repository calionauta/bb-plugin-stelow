// CLI dispatcher helpers: nearest-command suggestions and help text shaped
// like BB 0.43 `defineCli` (suggest the nearest declared name, render help
// from the declared metadata) without rewriting the hand-written argv parsing
// the order-dependent commands (`ask` groups, `lock` flags) rely on.
// Unit-tested in tests/cli-suggest.test.mjs.

function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j++) grid[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return grid[a.length][b.length];
}

/**
 * Nearest declared command for a mistyped invocation, or null when nothing
 * is close. Case-insensitive; ties resolve to registration order so the
 * suggestion is stable.
 */
export function nearestCommand(input, names) {
  if (typeof input !== "string" || !input.trim() || !Array.isArray(names)) return null;
  const want = input.trim().toLowerCase();
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const name of names) {
    if (typeof name !== "string" || !name) continue;
    const distance = editDistance(want, name.toLowerCase());
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  if (best === null) return null;
  const threshold = Math.min(3, Math.max(1, Math.floor(Math.max(want.length, best.length) / 2)));
  return bestDistance <= threshold ? best : null;
}

/** `Usage: bb stelow a|b|c` derived from the declared metadata — never pasted. */
export function cliUsageLine(commands) {
  const names = (Array.isArray(commands) ? commands : [])
    .map((entry) => entry?.name)
    .filter((name) => typeof name === "string" && name);
  return `Usage: bb stelow ${names.join("|")}`;
}

/** Human help for one command, or the full list for bare `help`. */
export function cliHelpText(commands, name) {
  const list = Array.isArray(commands) ? commands : [];
  if (typeof name === "string" && name) {
    const entry = list.find((candidate) => candidate?.name === name);
    if (!entry) return null;
    return [`${entry.name}: ${entry.summary}`, entry.usage].filter(Boolean).join("\n");
  }
  return list.map((entry) => `${entry.name}: ${entry.summary}`).join("\n");
}
