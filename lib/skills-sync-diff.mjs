import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitBlobSha } from "./skills-sync-fetch.mjs";

/**
 * Diff phase of the release-time Stelow sync: local state, upstream
 * manifests, and the pure drift core the CI gate runs. No network here —
 * every remote fact arrives as an argument from the fetch phase.
 */

export { gitBlobSha };

export const STATE_FILE = ".sync-state.json";

export const CORE_SKILLS = [
  "stelow-workflow-entry",
  "stelow-workflow-router",
  "stelow-workflow-orchestrator",
  "stelow-workflow-shape-up",
  "stelow-workflow-interface-alternatives",
  "stelow-workflow-interface-contrast",
  "stelow-workflow-plan-critique",
  "stelow-workflow-tech-planning",
  "stelow-workflow-scope-executor",
  "stelow-workflow-ux-critique",
  "stelow-workflow-codebase-critique",
  "stelow-workflow-coding-standards",
  "stelow-workflow-testing-ai-code",
  "stelow-workflow-testing-execution",
  "stelow-workflow-execution-critique",
];

export const WORKFLOW_SKILLS = CORE_SKILLS;

// Single files synced like skill files so local copies stay byte-identical
// to the pinned upstream commit. data/stelow used to be a hand-maintained fork (mode-skips,
// gate refusals, non-git roots); those rules now live upstream, so the fork
// retired into a synced copy. product-strategies.json carries the neutral
// per-strategy contracts hosts translate into their own presentation.
// data/stelow-package.json carries the upstream release version only (used
// for the About tab) — the plugin never executes it.
function assertSingleFilePresent(entry, { repoPath, optional, log }) {
  if (entry) return;
  if (optional) {
    log(`stelow file sync: ${repoPath} absent at pinned commit; preserving local copy`);
    return;
  }
  throw new Error(`no ${repoPath} in repo tree`);
}

export const SINGLE_FILES = [
  { repoPath: "scripts/stelow", stateKey: "scripts/stelow", localRel: "data/stelow" },
  { repoPath: "product-strategies.json", stateKey: "product-strategies.json", localRel: "data/product-strategies.json" },
  { repoPath: "package.json", stateKey: "package.json", localRel: "data/stelow-package.json" },
  // Optional on pins created before the generated catalog existed. A missing
  // remote file preserves the last good local copy; it is never deleted.
  {
    repoPath: "skills/stelow-workflow-orchestrator/stage-catalog.json",
    stateKey: "skills/stelow-workflow-orchestrator/stage-catalog.json",
    localRel: "data/stelow-stage-catalog.json",
    optional: true,
  },
  {
    repoPath: "skills/stelow-workflow-orchestrator/recipe-catalog.json",
    stateKey: "skills/stelow-workflow-orchestrator/recipe-catalog.json",
    localRel: "data/stelow-recipe-catalog.json",
    optional: true,
  },
  { repoPath: "recipes.schema.json", stateKey: "recipes.schema.json", localRel: "data/stelow-recipes.schema.json", optional: true },
];

export const EXECUTION_ASSET_PREFIXES = ["recipes/", "schemas/"];

export { assertSingleFilePresent };

/** Recursively list files under a directory (relative to rootDir, POSIX slashes). */
export function walk(rootDir, dir = rootDir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rootDir, abs));
    else out.push({ rel: abs.slice(rootDir.length + 1).split("\\").join("/"), abs });
  }
  return out;
}

/**
 * Compute a map of the last-synced remote blob sha per skill/rel from the
 * state file, so unchanged files skip the download on every tick. The state
 * file path is explicit (not derived): production points outside skills/
 * so bb's skill scan never sees it, while temp-dir targets (tests) keep
 * the default beside the target and stay isolated.
 */
export function loadState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) || {};
  } catch {
    return {};
  }
}

export function saveState(stateFile, state) {
  try {
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch {
    /* state write is best-effort; a stale state only causes redundant downloads */
  }
}

/** Default state location beside the sync target (tests, one-off runs). */
export function defaultStateFile(targetDir) {
  return join(targetDir, STATE_FILE);
}

/** Last release-sync verification, epoch ms. Retained in the optional
 * release-time state file for idempotence diagnostics; it is never presented
 * as a runtime freshness claim. Keyed with a $ prefix so it cannot collide
 * with a skill file path. */
export const SYNC_TIMESTAMP_KEY = "$syncedAt";

export function readLastSyncAt(stateFile) {
  try {
    const value = loadState(stateFile)[SYNC_TIMESTAMP_KEY];
    return typeof value === "number" && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Read the immutable upstream revision this plugin release ships. */
export function readPinnedStelowSource(repoRoot) {
  try {
    const source = JSON.parse(readFileSync(join(repoRoot, "data", "stelow-source.json"), "utf8"));
    if (typeof source?.version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(source.version)) throw new Error("version is invalid");
    if (typeof source?.commit !== "string" || !/^[0-9a-f]{40}$/.test(source.commit)) throw new Error("commit is invalid");
    return { version: source.version, commit: source.commit };
  } catch (error) {
    throw new Error(`invalid data/stelow-source.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Mode bits of a live file, or null when it does not exist. */
export function fileMode(path) {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

/** Git blob sha of a file on disk (same digest the tree API reports). */
export function localGitBlobSha(path) {
  return gitBlobSha(readFileSync(path));
}

/**
 * Read the versioned upstream-fork allowlist. Fail-closed: a missing or
 * corrupt allowlist excuses nothing, so drift can never hide behind a
 * broken file. Behavioral (`area`) entries document standing host policy
 * divergences; file (`path`) entries excuse one vendored path each.
 */
export function readUpstreamForks(repoRoot) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(repoRoot, "data", "upstream-forks.json"), "utf8"));
  } catch (error) {
    throw new Error(`invalid data/upstream-forks.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.forks)) {
    throw new Error("invalid data/upstream-forks.json: expected { pin, upstream_version, forks[] }");
  }
  for (const fork of parsed.forks) {
    if (!fork || typeof fork.reason !== "string" || fork.reason.length === 0) {
      throw new Error("invalid data/upstream-forks.json: every fork states a reason");
    }
    if (typeof fork.path !== "string" && typeof fork.area !== "string") {
      throw new Error("invalid data/upstream-forks.json: every fork names a path or an area");
    }
  }
  return parsed;
}

/**
 * Pure drift core: compare local path→sha against remote path→sha.
 * Returns [{ path, kind }] with kind one of modified | extra-local |
 * missing-local, sorted for deterministic logs. Pure so the gate is
 * unit-testable without network or fixtures.
 */
export function diffFileMaps(local, remote) {
  const diffs = [];
  for (const [path, sha] of local) {
    if (!remote.has(path)) diffs.push({ path, kind: "extra-local" });
    else if (remote.get(path) !== sha) diffs.push({ path, kind: "modified" });
  }
  for (const path of remote.keys()) {
    if (!local.has(path)) diffs.push({ path, kind: "missing-local" });
  }
  return diffs.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Split drift into allowlisted hits (reported, not hidden) and unlisted
 * drift (the CI failure). Stale entries — allowlisted paths with no drift —
 * are returned separately so the caller warns instead of failing: the next
 * upstream sync heals a fork by overwriting it, and the entry must go then.
 */
export function applyAllowlist(diffs, allowlist) {
  const allowed = new Map();
  for (const fork of allowlist?.forks ?? []) {
    if (typeof fork.path === "string") allowed.set(fork.path, fork);
  }
  const listed = [];
  const unlisted = [];
  for (const diff of diffs) {
    const fork = allowed.get(diff.path);
    if (fork) listed.push({ ...diff, reason: fork.reason });
    else unlisted.push(diff);
  }
  const hit = new Set(listed.map((entry) => entry.path));
  const stale = [...allowed.keys()].filter((path) => !hit.has(path));
  return { listed, unlisted, stale };
}
