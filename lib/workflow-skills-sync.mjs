import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

/**
 * Auto-sync the plugin's vendored Stelow workflow skills against the
 * calionauta/stelow repo, so a methodology update propagates to the plugin
 * without any manual re-install.
 *
 * Scope: only the `stelow-workflow-*` (core) skills plus entry/router — the
 * product playbooks are NOT vendored here (they are consumed from the agent
 * skills hub via `npx skills add calionauta/stelow`).
 *
 * Fail-soft: any error returns a summary with `error` set and persists the
 * current on-disk skills untouched. The plugin never breaks because sync
 * failed.
 */

const REPO = "calionauta/stelow";
const BRANCH = "main";
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

const TREE_URL = (branch) => `https://api.github.com/repos/${REPO}/git/trees/${branch}?recursive=1`;
const RAW_URL = (path) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;

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
 * Fetch the GitHub tree for the stelow repo: [{ path, sha }] blobs.
 */
async function fetchTreeBlobs() {
  const res = await fetch(TREE_URL(BRANCH), {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "bb-plugin-stelow-sync" },
  });
  if (!res.ok) throw new Error(`GitHub tree fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!Array.isArray(data.tree)) throw new Error("GitHub tree response malformed");
  return data.tree.filter((entry) => entry.type === "blob").map((entry) => ({ path: entry.path, sha: entry.sha }));
}

/**
 * Fetch the GitHub tree for the stelow repo and return the core-skill files:
 * [{ skill, rel, sha }] where sha is the git blob sha (our change key).
 */
async function fetchCoreSkillTree() {
  const blobs = await fetchTreeBlobs();
  const wanted = new Set(CORE_SKILLS);
  const files = [];
  for (const { path, sha } of blobs) {
    if (!path.startsWith(SRC_PREFIX)) continue;
    const slash = path.indexOf("/", SRC_PREFIX.length);
    if (slash === -1) continue;
    const skill = path.slice(SRC_PREFIX.length, slash);
    if (!wanted.has(skill)) continue;
    files.push({ skill, rel: path.slice(slash + 1), sha });
  }
  return files;
}

/** Download one repo path and verify its bytes against the tree sha. */
async function fetchVerifiedBlob(repoPath, sha) {
  const res = await fetch(RAW_URL(repoPath), { headers: { "User-Agent": "bb-plugin-stelow-sync" } });
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

/** Last upstream verification, epoch ms. Recorded on every sync run —
 * changed files or not — so the About tab can show "skills synced X ago".
 * Keyed with a $ prefix so it can never collide with a skill file path. */
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
 * One-time migration: when state moved to an explicit path, delete the
 * legacy default copy so bb's skill scan stops warning about it. Best
 * effort; a leftover only costs log spam, never correctness.
 */
function removeLegacyState(targetDir, stateFile) {
  const legacy = defaultStateFile(targetDir);
  if (legacy === stateFile || !existsSync(legacy)) return;
  try { rmSync(legacy, { force: true }); } catch { /* ignore */ }
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
/**
 * Sync local core skills to the repo HEAD. Returns
 * { changed, updated[], created[], removed[], errors[] }.
 */
export async function syncWorkflowSkills(targetDir, { log = () => {}, statePath } = {}) {
  const result = { changed: false, updated: [], created: [], removed: [], errors: [] };
  const stateFile = statePath ?? defaultStateFile(targetDir);
  try {
    const remote = await fetchCoreSkillTree();
    const bySkill = {};
    for (const f of remote) (bySkill[f.skill] ||= []).push(f);

    mkdirSync(targetDir, { recursive: true });
    const state = loadState(stateFile);
    const nextState = {};

    for (const skill of CORE_SKILLS) {
      const remoteFiles = bySkill[skill] || [];
      const remoteMap = {};
      for (const f of remoteFiles) remoteMap[f.rel] = f;

      // Remove local files no longer in repo.
      const dir = join(targetDir, skill);
      if (existsSync(dir)) {
        for (const f of walk(dir)) {
          if (!(f.rel in remoteMap) && f.rel !== STATE_FILE) {
            try { rmSync(f.abs, { force: true }); result.removed.push(`${skill}/${f.rel}`); } catch (e) { result.errors.push(`rm ${skill}/${f.rel}: ${e.message}`); }
          }
        }
      }

      // Write/update files that differ from the last-synced remote sha.
      for (const rel of Object.keys(remoteMap)) {
        const key = `${skill}/${rel}`;
        if (state[key] === remoteMap[rel].sha) { nextState[key] = remoteMap[rel].sha; continue; } // unchanged since last sync
        const abs = join(targetDir, skill, rel);
        const existed = existsSync(abs);
        try {
          const res = await fetch(RAW_URL(`${SRC_PREFIX}${skill}/${rel}`), { headers: { "User-Agent": "bb-plugin-stelow-sync" } });
          if (!res.ok) { result.errors.push(`fetch ${key}: ${res.status}`); continue; }
          const content = Buffer.from(await res.arrayBuffer());
          if (gitBlobSha(content) !== remoteMap[rel].sha) {
            // CDN served a stale blob for a fresh tree sha (happens right
            // after pushes). Keep the old state so the next sync retries
            // instead of pinning stale bytes under a fresh sha forever.
            result.errors.push(`stale ${key}: content sha mismatch, will retry next sync`);
            continue;
          }
          nextState[key] = remoteMap[rel].sha;
          mkdirSync(dirname(abs), { recursive: true });
          const tmp = `${abs}.tmp.${process.pid}`;
          writeFileSync(tmp, content);
          renameSync(tmp, abs);
          (existed ? result.updated : result.created).push(key);
        } catch (e) { result.errors.push(`${key}: ${e.message}`); }
      }
    }

    nextState[SYNC_TIMESTAMP_KEY] = Date.now();
    saveState(stateFile, nextState);
    removeLegacyState(targetDir, stateFile);

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
// to upstream. data/stelow used to be a hand-maintained fork (mode-skips,
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
    const blobs = await fetchTreeBlobs();
    const state = loadState(stateFile);
    let dirty = false;
    for (const { repoPath, stateKey, localRel } of SINGLE_FILES) {
      const entry = blobs.find((b) => b.path === repoPath);
      if (!entry) throw new Error(`no ${repoPath} in repo tree`);
      if (state[stateKey] === entry.sha) continue;
      const content = await fetchVerifiedBlob(repoPath, entry.sha);
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
    state[SYNC_TIMESTAMP_KEY] = Date.now();
    saveState(stateFile, state);
    removeLegacyState(skillsDir, stateFile);
    result.changed = dirty;
    return result;
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }
}