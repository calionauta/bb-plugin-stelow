/**
 * A Build receipt must be backed by one host-run test command, never only an
 * agent-authored claim. Commands are selected from conventional project files
 * and executed with execFile, so no shell text from a card can run here.
 */
export function detectedTestCommand(entries, packageJson = null) {
  const names = new Set(Array.isArray(entries) ? entries.filter((entry) => typeof entry === "string") : []);
  if (packageJson?.scripts?.test && typeof packageJson.scripts.test === "string") {
    if (names.has("pnpm-lock.yaml")) return { command: "pnpm", args: ["test"], display: "pnpm test" };
    if (names.has("yarn.lock")) return { command: "yarn", args: ["test"], display: "yarn test" };
    return { command: "npm", args: ["test"], display: "npm test" };
  }
  if (names.has("go.mod")) return { command: "go", args: ["test", "./..."], display: "go test ./..." };
  if (names.has("Cargo.toml")) return { command: "cargo", args: ["test"], display: "cargo test" };
  if (names.has("pyproject.toml") || names.has("pytest.ini") || names.has("tox.ini")) return { command: "pytest", args: [], display: "pytest" };
  return null;
}

export function verificationReadiness(run, gitEvidence) {
  if (!run || run.exit_code !== 0) return { ready: false, error: "Run `bb stelow verify --tests` successfully from this Build card before marking it Done. The host records the command, result, checkout, and HEAD." };
  if (!gitEvidence?.gitRoot || !gitEvidence?.headSha || run.git_root !== gitEvidence.gitRoot || run.head_sha !== gitEvidence.headSha) {
    return { ready: false, error: "The last host-run test result belongs to a different checkout or HEAD. Re-run `bb stelow verify --tests` after the current audit." };
  }
  return { ready: true, error: null };
}
