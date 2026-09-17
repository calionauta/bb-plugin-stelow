import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, renameSync, mkdtempSync, copyFileSync, statSync, chmodSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Release-time sync for the plugin's vendored Stelow assets. Runtime code
 * never calls these functions: a published plugin must execute the helper and
 * skills it shipped, rather than silently adopting upstream main.
 *
 * Scope: every top-level skills/stelow-<name>/ directory upstream — workflow
 * skills AND product playbooks. Discovery is dynamic (no allowlist), so a
 * new upstream skill arrives on the next sync and a removed one is pruned.
 * Fail-soft: any error returns a summary with `error` set and persists the
 * current on-disk skills untouched. The plugin never breaks because sync
 * failed.
 */

const REPO = "calionauta/stelow";
const SRC_PREFIX = "skills/";
const STATE_FILE = ".sync-state.json";
const CORE_SKILLS = [
  "stelow-workflow-entry",
  "stelow-workflow-router",
  "stelow-workflow-orchestrator",
  "stelow-workflow-shape-up",
  "stelow-workflow-interface-alternatives",
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

const TREE_URL = (ref) => `https://api.github.com/repos/${REPO}/git/trees/${ref}?recursive=1`;
const RAW_URL = (ref, path) => `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;

/** Recursively list files under a directory (relative to rootDir, POSIX slashes). */
function walk(rootDir, dir = rootDir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rootDir, abs));
    else out.push({ rel: abs.slice(rootDir.length + 1).split("\\").join("/"), abs });
  }
  return out;
}

/**
 * One release sync uses the same immutable tree for skills and helper. Cache
 * by commit so syncing both does not spend two GitHub tree requests.
 */
const TREE_TTL_MS = 60_000;
const treeCache = new Map();

/**
 * Fetch the GitHub tree for the stelow repo: [{ path, sha }] blobs.
 * Throws (never caches) on failure, so a bad response is retried next call.
 */
async function fetchTreeBlobs(ref) {
  const cached = treeCache.get(ref);
  if (cached?.blobs && Date.now() - cached.at < TREE_TTL_MS) return cached.blobs;
  const res = await fetch(TREE_URL(ref), {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "bb-plugin-stelow-sync" },
  });
  if (!res.ok) throw new Error(`GitHub tree fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!Array.isArray(data.tree)) throw new Error("GitHub tree response malformed");
  // A truncated tree would prune valid local skills as "retired" — refuse
  // the whole sync (fail-soft keeps everything) instead of half-syncing.
  if (data.truncated) throw new Error("GitHub tree response truncated — refusing partial sync");
  const blobs = data.tree.filter((entry) => entry.type === "blob").map((entry) => ({ path: entry.path, sha: entry.sha }));
  treeCache.set(ref, { at: Date.now(), blobs });
  return blobs;
}

/**
 * Fetch the GitHub tree for the stelow repo and return every file under a
 * top-level skills/stelow-<name>/ directory: [{ skill, rel, sha }].
 * Dynamic discovery (not the CORE_SKILLS allowlist below, which only scopes
 * worker-context injection): new upstream skills arrive automatically,
 * retired ones vanish from the tree and get pruned by the caller.
 */
async function fetchStelowSkillTree(ref) {
  const blobs = await fetchTreeBlobs(ref);
  const files = [];
  for (const { path, sha } of blobs) {
    if (!path.startsWith(SRC_PREFIX)) continue;
    const slash = path.indexOf("/", SRC_PREFIX.length);
    if (slash === -1) continue;
    const skill = path.slice(SRC_PREFIX.length, slash);
    if (!skill.startsWith("stelow-")) continue;
    files.push({ skill, rel: path.slice(slash + 1), sha });
  }
  return files;
}

/** Download one repo path and verify its bytes against the tree sha. */
async function fetchVerifiedBlob(ref, repoPath, sha) {
  const res = await fetch(RAW_URL(ref, repoPath), { headers: { "User-Agent": "bb-plugin-stelow-sync" } });
  if (!res.ok) throw new Error(`fetch ${repoPath}: ${res.status}`);
  const content = Buffer.from(await res.arrayBuffer());
  if (gitBlobSha(content) !== sha) throw new Error(`stale ${repoPath}: content sha mismatch, will retry next sync`);
  return content;
}

/**
 * Compute a map of the last-synced remote blob sha per skill/rel from the
 * state file, so unchanged files skip the download on every tick. The state
 * file path is explicit (not derived): production points outside skills/
 * so bb's skill scan never sees it, while temp-dir targets (tests) keep
 * the default beside the target and stay isolated.
 */
function loadState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) || {};
  } catch {
    return {};
  }
}

function saveState(stateFile, state) {
  try {
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch {
    /* state write is best-effort; a stale state only causes redundant downloads */
  }
}

/** Default state location beside the sync target (tests, one-off runs). */
function defaultStateFile(targetDir) {
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

/**
 * Git blob sha of fetched bytes ("blob <len>\\0<content>").
 * The raw CDN can serve a stale blob right after a push while the tree API
 * already reports the new sha; writing it would pin stale content under a
 * fresh sha forever (future syncs skip by sha match). Verify before writing.
 */
export function gitBlobSha(content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest("hex");
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
function fileMode(path) {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

/** Sync local core skills to one immutable upstream commit. */
export async function syncWorkflowSkills(targetDir, { ref, log = () => {}, statePath } = {}) {
  const result = { changed: false, updated: [], created: [], removed: [], errors: [] };
  const stateFile = statePath ?? defaultStateFile(targetDir);
  try {
    if (typeof ref !== "string" || !/^[0-9a-f]{40}$/.test(ref)) throw new Error("sync requires an immutable 40-character commit ref");
    const remote = await fetchStelowSkillTree(ref);
    const bySkill = {};
    for (const f of remote) (bySkill[f.skill] ||= []).push(f);
    // Sorted for deterministic logs; every upstream stelow-* skill ships.
    const skills = Object.keys(bySkill).sort();

    mkdirSync(targetDir, { recursive: true });
    const absTarget = resolve(targetDir);
    const state = loadState(stateFile);
    const nextState = {};

    // Atomic per-skill publish. Each skill is fully staged in a sibling
    // directory — invisible to bb's skill scan — then rename-swapped into
    // place, so a concurrent thread start hashes a complete tree (old or
    // new), never a half-written one. A swap is two renames; the
    // microsecond gap where the skill reads missing resolves as an
    // unknown hash (fail-soft), and the next attempt converges.
    // A killed sync can orphan its staging dir; it sits beside skills/
    // (never inside it) and later syncs never touch it.
    const stagingRoot = mkdtempSync(`${absTarget}.staging.`);
    try {
      for (const skill of skills) {
        const remoteFiles = bySkill[skill] || [];
        const remoteMap = {};
        for (const f of remoteFiles) remoteMap[f.rel] = f;
        const stageDir = join(stagingRoot, skill);
        const liveDir = join(absTarget, skill);
        mkdirSync(stageDir, { recursive: true });

        for (const rel of Object.keys(remoteMap)) {
          const key = `${skill}/${rel}`;
          const dest = join(stageDir, rel);
          const live = join(liveDir, rel);
          const liveExists = existsSync(live);
          // Unchanged since last sync: carry the live bytes forward so the
          // staged tree is complete without re-downloading.
          if (state[key] === remoteMap[rel].sha && liveExists) {
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(live, dest);
            nextState[key] = remoteMap[rel].sha;
            continue;
          }
          try {
            const res = await fetch(RAW_URL(ref, `${SRC_PREFIX}${skill}/${rel}`), { headers: { "User-Agent": "bb-plugin-stelow-sync" } });
            if (!res.ok) throw new Error(`fetch ${key}: ${res.status}`);
            const content = Buffer.from(await res.arrayBuffer());
            if (gitBlobSha(content) !== remoteMap[rel].sha) throw new Error(`stale ${key}: content sha mismatch, will retry next sync`);
            mkdirSync(dirname(dest), { recursive: true });
            writeFileSync(dest, content);
            nextState[key] = remoteMap[rel].sha;
            (liveExists ? result.updated : result.created).push(key);
          } catch (e) {
            // A failed download must not delete a good live file: carry it
            // into the staged tree and keep its old sha so the next sync
            // retries instead of pinning the gap.
            if (liveExists) {
              mkdirSync(dirname(dest), { recursive: true });
              copyFileSync(live, dest);
              nextState[key] = state[key];
            }
            result.errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
            continue;
          }
          // Raw downloads carry no mode bits: keep the live mode (e.g. +x
          // on helper scripts) so identical content keeps its tree hash.
          const mode = fileMode(live);
          if (mode !== null) {
            try { chmodSync(dest, mode); } catch { /* best-effort */ }
          }
        }

        // Local files retired upstream vanish via the swap; record them
        // for the trail instead of deleting one by one.
        if (existsSync(liveDir)) {
          for (const f of walk(liveDir)) {
            if (!(f.rel in remoteMap) && f.rel !== STATE_FILE) result.removed.push(`${skill}/${f.rel}`);
          }
          renameSync(liveDir, join(stagingRoot, `__prev_${skill}`));
        }
        renameSync(stageDir, liveDir);
      }

      // Prune retired skills: local top-level stelow-* dirs missing upstream.
      // Anything not starting with stelow- is never touched (not ours).
      for (const entry of readdirSync(absTarget, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("stelow-")) continue;
        if (entry.name in bySkill) continue;
        try { rmSync(join(absTarget, entry.name), { recursive: true, force: true }); result.removed.push(`${entry.name}/`); } catch (e) { result.errors.push(`rm ${entry.name}: ${e.message}`); }
      }
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }

    // Stamp only clean verifications: on partial failure the previous
    // timestamp stands, so About shows growing age instead of a fresh lie.
    if (result.errors.length === 0) nextState[SYNC_TIMESTAMP_KEY] = Date.now();
    saveState(stateFile, nextState);

    result.changed = result.updated.length > 0 || result.created.length > 0 || result.removed.length > 0;
    if (result.changed) log(`stelow skills sync: ${result.updated.length} updated, ${result.created.length} created, ${result.removed.length} removed`);
    if (result.errors.length) log(`stelow skills sync: ${result.errors.length} errors (fail-soft)`);
    return result;
  } catch (e) {
    result.errors.push(`sync failed: ${e.message}`);
    return result;
  }
}

export const WORKFLOW_SKILLS = CORE_SKILLS;

// Single files synced like skill files so local copies stay byte-identical
// to the pinned upstream commit. data/stelow used to be a hand-maintained fork (mode-skips,
// gate refusals, non-git roots); those rules now live upstream, so the fork
// retired into a synced copy. product-strategies.json carries the neutral
// per-strategy contracts hosts translate into their own presentation.
// data/stelow-package.json carries the upstream release version only (used
// for the About tab) — the plugin never executes it.
const SINGLE_FILES = [
  { repoPath: "scripts/stelow", stateKey: "scripts/stelow", localRel: "data/stelow" },
  { repoPath: "product-strategies.json", stateKey: "product-strategies.json", localRel: "data/product-strategies.json" },
  { repoPath: "package.json", stateKey: "package.json", localRel: "data/stelow-package.json" },
];

/**
 * Sync single upstream files (helper script, strategy registry) into
 * <repoRoot>/data/. The skills state file carries each sha. Idempotent;
 * fail-soft like skills.
 */
export async function syncHelperScript(repoRoot, { log = () => {}, statePath } = {}) {
  const result = { changed: false, updated: [], created: [], errors: [] };
  const skillsDir = join(repoRoot, "skills");
  const stateFile = statePath ?? defaultStateFile(skillsDir);
  try {
    const source = readPinnedStelowSource(repoRoot);
    const blobs = await fetchTreeBlobs(source.commit);
    const state = loadState(stateFile);
    let dirty = false;
    for (const { repoPath, stateKey, localRel } of SINGLE_FILES) {
      const entry = blobs.find((b) => b.path === repoPath);
      if (!entry) throw new Error(`no ${repoPath} in repo tree`);
      if (state[stateKey] === entry.sha) continue;
      const content = await fetchVerifiedBlob(source.commit, repoPath, entry.sha);
      const abs = join(repoRoot, localRel);
      const existed = existsSync(abs);
      mkdirSync(dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp.${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, abs);
      state[stateKey] = entry.sha;
      dirty = true;
      (existed ? result.updated : result.created).push(repoPath);
      log(`stelow file sync: ${repoPath} ${existed ? "updated" : "created"}`);
    }
    if (result.errors.length === 0) state[SYNC_TIMESTAMP_KEY] = Date.now();
    saveState(stateFile, state);
    result.changed = dirty;
    return result;
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }
}
