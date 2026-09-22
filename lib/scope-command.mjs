/**
 * Argument parser for `bb stelow scope <start|done>` (pure, no I/O).
 *
 * The worker has no scripts/stelow binary, so the host wrapper parses
 * worker input and forwards a strict allowlist to the helper. Anything
 * outside the allowlist refuses with usage (exit 2) instead of leaking
 * into the helper's argv. Returns { op, scopeId, passthrough } or
 * { error } — never throws, never guesses.
 */

const VALUE_FLAGS = new Set(["--scope", "--project", "--name", "--iteration", "--actual-files", "--tasks", "--start-sha"]);
const FORWARD_VALUE_FLAGS = ["--name", "--iteration", "--actual-files", "--tasks", "--start-sha"];
const USAGE = "Usage: bb stelow scope <start|done|seed-tasks> --scope <id> [--project <proj_id>] [--name <workflow>] [--iteration <n>] [--actual-files <a,b>] [--tasks <json>] [--start-sha <sha>] [--json]";

export function parseScopeArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const op = args[0];
  if (op !== "start" && op !== "done" && op !== "seed-tasks") return { error: USAGE };
  const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const scopeId = flag("--scope");
  if (typeof scopeId !== "string" || !scopeId || scopeId.startsWith("--")) return { error: USAGE };
  const passthrough = [op, "--scope", scopeId];
  for (const name of FORWARD_VALUE_FLAGS) {
    const value = flag(name);
    if (value !== undefined) passthrough.push(name, value);
  }
  if (args.includes("--json")) passthrough.push("--json");
  const consumed = new Set(["--scope", "--project", "--name", "--iteration", "--actual-files", "--tasks", "--start-sha", "--json", scopeId]);
  let skipNext = false;
  for (let i = 1; i < args.length; i++) {
    if (skipNext) { skipNext = false; continue; }
    const arg = args[i];
    if (arg === "--json" || arg === scopeId) continue;
    if (typeof arg === "string" && consumed.has(arg)) {
      if (VALUE_FLAGS.has(arg) && (i + 1 >= args.length || String(args[i + 1]).startsWith("--"))) return { error: USAGE };
      skipNext = true;
      continue;
    }
    return { error: USAGE };
  }
  return { op, scopeId, passthrough, projectId: flag("--project") ?? null };
}

export function scopeCommandUsage() {
  return USAGE;
}
