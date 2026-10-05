/**
 * A Build receipt must be backed by one host-run test command, never only an
 * agent-authored claim. Commands are selected from conventional project files
 * and executed with execFile, so no shell text from a card can run here.
 */

/** State-dir snapshot of frozen technical acceptance (test_map + red_proof). */
export const FROZEN_ACCEPTANCE_FILE = "frozen-acceptance.json";

/**
 * Parse a frozen-acceptance snapshot into { baseline, testMap, redProof,
 * freezeSha }. Snake_case on disk (like scope contracts), camelCase out.
 * Null on any misshape — callers treat a missing snapshot as "no snapshot
 * taken" (old cards fail open), never as a crash. A PRESENT file that parses
 * to null is passed through as {} by the done gate so enforcement still
 * bites: presence opts the card in, junk does not opt it out.
 */
export function parseFrozenAcceptance(content) {
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : null;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const baseline = parsed.baseline && typeof parsed.baseline === "object" && !Array.isArray(parsed.baseline)
    ? parsed.baseline
    : null;
  const testMap = Array.isArray(parsed.test_map ?? parsed.testMap)
    ? (parsed.test_map ?? parsed.testMap)
    : null;
  const redProof = parsed.red_proof ?? parsed.redProof ?? null;
  const freezeSha = typeof parsed.freeze_sha === "string"
    ? parsed.freeze_sha
    : (typeof parsed.freezeSha === "string" ? parsed.freezeSha : null);
  if (!baseline && !testMap && !redProof && !freezeSha) return null;
  return { baseline, testMap, redProof, freezeSha };
}

/**
 * Frozen technical acceptance readiness (pure, no I/O). First failure wins,
 * in the order a worker repairs them: record the pre-change baseline, map
 * every criterion to its proving test, keep the FAIL proof, then freeze at
 * this HEAD. Codes are stable (MissingBaseline, UnmappedCriterion,
 * NoRedProof, FrozenAcceptance) so done refusals and verify warnings name
 * the same fact. Each check is its own function so the budget gate sees
 * four small steps instead of one long chain.
 */
export function checkFrozenBaseline(baseline) {
  if (baseline && typeof baseline === "object" && !Array.isArray(baseline) && Object.keys(baseline).length > 0) {
    return null;
  }
  return "No pre-change baseline was recorded — run each scope's verify "
    + "commands once before changing code and store the exit codes, "
    + "then re-freeze. Without a baseline, regressions are undetectable.";
}

export function checkFrozenTestMap(testMap) {
  const list = Array.isArray(testMap) ? testMap : null;
  const unmapped = list
    ? list.filter((entry) => {
      if (!entry || typeof entry !== "object") return true;
      const test = entry.test ?? entry.testCommand;
      return typeof test !== "string" || !test.trim();
    })
    : null;
  if (list && list.length > 0 && (!unmapped || unmapped.length === 0)) return null;
  const names = (unmapped ?? []).map((entry) => {
    if (!entry || typeof entry !== "object") return "unnamed criterion";
    const name = entry.criterion ?? entry.name;
    return typeof name === "string" && name.trim() ? name.trim() : "unnamed criterion";
  });
  const detail = names.length > 0 ? `: ${names.slice(0, 5).join("; ")}${names.length > 5 ? "…" : ""}` : "";
  return "Every acceptance criterion needs its proving test in test_map"
    + `${detail} — add the missing test command(s), then re-freeze. `
    + "An unmapped criterion certifies prose, not behavior.";
}

export function checkFrozenRedProof(redProof) {
  const proof = redProof && typeof redProof === "object" && !Array.isArray(redProof) ? redProof : null;
  const exit = proof
    ? (typeof proof.exit_code === "number" ? proof.exit_code : (typeof proof.exitCode === "number" ? proof.exitCode : null))
    : null;
  const command = proof
    ? (typeof proof.failed_command === "string" ? proof.failed_command : (typeof proof.failedCommand === "string" ? proof.failedCommand : ""))
    : "";
  const excerpt = proof
    ? (typeof proof.output_excerpt === "string" ? proof.output_excerpt : (typeof proof.outputExcerpt === "string" ? proof.outputExcerpt : ""))
    : "";
  if (proof && Number.isInteger(exit) && command.trim() && excerpt.trim()) return null;
  return "No red proof was recorded — keep the failing run "
    + "({failed_command, exit_code, output_excerpt}) in red_proof, "
    + "then re-freeze. Done certifies fixed work, "
    + "not work that never failed first.";
}

export function checkFrozenSha(freezeSha, headSha) {
  if (typeof freezeSha === "string" && freezeSha.trim() && freezeSha === headSha) return null;
  if (!freezeSha || !freezeSha.trim()) {
    return "No freeze_sha was recorded — freeze the technical acceptance (test_map + red_proof at this HEAD) before running done.";
  }
  return "The checkout moved since the freeze (freeze_sha "
    + `${freezeSha} != HEAD ${headSha}) — re-run \`bb stelow verify --tests\` and re-freeze, then run done.`;
}

export function frozenAcceptanceReadiness({ baseline, testMap, redProof, freezeSha, headSha } = {}) {
  const baselineError = checkFrozenBaseline(baseline);
  if (baselineError) return { ready: false, code: "MissingBaseline", error: baselineError };
  const mapError = checkFrozenTestMap(testMap);
  if (mapError) return { ready: false, code: "UnmappedCriterion", error: mapError };
  const proofError = checkFrozenRedProof(redProof);
  if (proofError) return { ready: false, code: "NoRedProof", error: proofError };
  const shaError = checkFrozenSha(freezeSha, headSha);
  if (shaError) return { ready: false, code: "FrozenAcceptance", error: shaError };
  return { ready: true, code: null, error: null };
}
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

/** True only when two independently sampled checkout identities agree. */
export function sameGitEvidence(expected, observed) {
  return Boolean(
    expected?.gitRoot
    && expected?.headSha
    && observed?.gitRoot
    && observed?.headSha
    && expected.gitRoot === observed.gitRoot
    && expected.headSha === observed.headSha,
  );
}

export function verificationReadiness(run, gitEvidence) {
  if (!run || run.exit_code !== 0) return { ready: false, error: "Run `bb stelow verify --tests` successfully from this Build card before marking it Done. The host records the command, result, checkout, and HEAD." };
  if (!sameGitEvidence({ gitRoot: run.git_root, headSha: run.head_sha }, gitEvidence)) {
    return { ready: false, error: "The last host-run test result belongs to a different checkout or HEAD. Re-run `bb stelow verify --tests` after the current audit." };
  }
  return { ready: true, error: null };
}

/**
 * The frozen snapshot projected onto the card hero row (pure, no I/O).
 * Null when there is nothing to mirror: a missing snapshot, or a test_map
 * with no mappable entry, is an absent fact — the row renders nothing
 * instead of warning about a freeze it does not hold.
 */
export function frozenDetailView(snapshot, headSha) {
  const parsed = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null;
  const list = parsed && Array.isArray(parsed.testMap) ? parsed.testMap : null;
  const entries = (list ?? [])
    .map((entry) => {
      const test = typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? entry.test ?? entry.testCommand
          : null;
      if (typeof test !== "string" || !test.trim()) return null;
      return { test, frozen: true, redProof: parsed.redProof ?? null };
    })
    .filter(Boolean);
  if (entries.length === 0) return null;
  return {
    frozenTestMap: entries,
    freezeSha: typeof parsed.freezeSha === "string" ? parsed.freezeSha : null,
    currentHeadSha: typeof headSha === "string" ? headSha : null,
  };
}
