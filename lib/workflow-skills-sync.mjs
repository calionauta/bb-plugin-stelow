import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";

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

// The two control-plane skills were renamed into the workflow namespace.
// Remove only these known plugin-owned legacy directories during sync.
const RETIRED_CORE_SKILLS = ["stelow-entry", "stelow-router"];

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
 * Fetch the GitHub tree for the stelow repo and return the core-skill files:
 * [{ skill, rel, sha }] where sha is the git blob sha (our change key).
 */
async function fetchCoreSkillTree() {
  const res = await fetch(TREE_URL(BRANCH), {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "bb-plugin-stelow-sync" },
  });
  if (!res.ok) throw new Error(`GitHub tree fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!Array.isArray(data.tree)) throw new Error("GitHub tree response malformed");
  const wanted = new Set(CORE_SKILLS);
  const files = [];
  for (const entry of data.tree) {
    if (entry.type !== "blob") continue;
    const p = entry.path;
    if (!p.startsWith(SRC_PREFIX)) continue;
    const slash = p.indexOf("/", SRC_PREFIX.length);
    if (slash === -1) continue;
    const skill = p.slice(SRC_PREFIX.length, slash);
    if (!wanted.has(skill)) continue;
    files.push({ skill, rel: p.slice(slash + 1), sha: entry.sha });
  }
  return files;
}

/**
 * Compute a map of the last-synced remote blob sha per skill/rel from the
 * state file, so unchanged files skip the download on every tick.
 */
function loadState(targetDir) {
  try {
    return JSON.parse(readFileSync(join(targetDir, STATE_FILE), "utf8")) || {};
  } catch {
    return {};
  }
}

function saveState(targetDir, state) {
  try {
    writeFileSync(join(targetDir, STATE_FILE), JSON.stringify(state, null, 2));
  } catch {
    /* state write is best-effort; a stale state only causes redundant downloads */
  }
}

/**
 * Sync local core skills to the repo HEAD. Returns
 * { changed, updated[], created[], removed[], errors[] }.
 */
export async function syncWorkflowSkills(targetDir, { log = () => {} } = {}) {
  const result = { changed: false, updated: [], created: [], removed: [], errors: [] };
  try {
    const remote = await fetchCoreSkillTree();
    const bySkill = {};
    for (const f of remote) (bySkill[f.skill] ||= []).push(f);

    mkdirSync(targetDir, { recursive: true });
    const state = loadState(targetDir);
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
        nextState[key] = remoteMap[rel].sha;
        if (state[key] === remoteMap[rel].sha) continue; // unchanged since last sync
        const abs = join(targetDir, skill, rel);
        const existed = existsSync(abs);
        try {
          const res = await fetch(RAW_URL(`${SRC_PREFIX}${skill}/${rel}`), { headers: { "User-Agent": "bb-plugin-stelow-sync" } });
          if (!res.ok) { result.errors.push(`fetch ${key}: ${res.status}`); continue; }
          const content = Buffer.from(await res.arrayBuffer());
          mkdirSync(dirname(abs), { recursive: true });
          const tmp = `${abs}.tmp.${process.pid}`;
          writeFileSync(tmp, content);
          renameSync(tmp, abs);
          (existed ? result.updated : result.created).push(key);
        } catch (e) { result.errors.push(`${key}: ${e.message}`); }
      }
    }

    for (const retired of RETIRED_CORE_SKILLS) {
      const dir = join(targetDir, retired);
      if (!existsSync(dir)) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
        result.removed.push(`${retired}/`);
      } catch (e) {
        result.errors.push(`rm ${retired}: ${e.message}`);
      }
    }

    saveState(targetDir, nextState);

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