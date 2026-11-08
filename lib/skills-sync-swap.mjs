import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fetchStelowSkillTree, fetchTreeBlobs, fetchVerifiedBlob } from "./skills-sync-fetch.mjs";
import {
  EXECUTION_ASSET_PREFIXES, SINGLE_FILES, SYNC_TIMESTAMP_KEY, assertSingleFilePresent,
  defaultStateFile, fileMode, loadState, saveState, walk, readPinnedStelowSource,
} from "./skills-sync-diff.mjs";

/**
 * Swap phase of the release-time Stelow sync: stage, publish, prune.
 * Every publish is atomic per skill (fully staged beside skills/, then
 * rename-swapped), so a concurrent thread start hashes a complete tree.
 */

/** Group remote [{ skill, rel, sha }] by skill name, sorted downstream. */
function groupBySkill(remote) {
  const bySkill = {};
  for (const f of remote) (bySkill[f.skill] ||= []).push(f);
  return bySkill;
}

/** Stage one remote file: download-and-verify, or carry the live bytes
 * forward when the state sha already matches. A failed download never
 * deletes a good live file — it carries it over and keeps the old sha so
 * the next sync retries instead of pinning the gap. */
async function stageSkillFile({ skill, rel, sha, liveDir, stageDir, state, nextState, result, ref }) {
  const key = `${skill}/${rel}`;
  const dest = join(stageDir, rel);
  const live = join(liveDir, rel);
  const liveExists = existsSync(live);
  if (state[key] === sha && liveExists) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(live, dest);
    nextState[key] = sha;
    return;
  }
  try {
    const content = await fetchVerifiedBlob(ref, `skills/${skill}/${rel}`, sha);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    nextState[key] = sha;
    (liveExists ? result.updated : result.created).push(key);
  } catch (e) {
    if (liveExists) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(live, dest);
      nextState[key] = state[key];
    }
    result.errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  // Raw downloads carry no mode bits: keep the live mode (e.g. +x
  // on helper scripts) so identical content keeps its tree hash.
  const mode = fileMode(live);
  if (mode !== null) {
    try { chmodSync(dest, mode); } catch { /* best-effort */ }
  }
}

/** Stage every file of one skill, then rename-swap it into place. Local
 * files retired upstream vanish via the swap and are reported, never
 * deleted one by one. A swap is two renames; the microsecond gap where the
 * skill reads missing resolves as an unknown hash (fail-soft). */
async function stageSkill({ skill, remoteFiles, absTarget, stagingRoot, state, nextState, result, ref }) {
  const remoteMap = {};
  for (const f of remoteFiles) remoteMap[f.rel] = f;
  const stageDir = join(stagingRoot, skill);
  const liveDir = join(absTarget, skill);
  mkdirSync(stageDir, { recursive: true });
  for (const rel of Object.keys(remoteMap)) {
    await stageSkillFile({ skill, rel, sha: remoteMap[rel].sha, liveDir, stageDir, state, nextState, result, ref });
  }
  if (existsSync(liveDir)) {
    for (const f of walk(liveDir)) {
      if (!(f.rel in remoteMap)) result.removed.push(`${skill}/${f.rel}`);
    }
    renameSync(liveDir, join(stagingRoot, `__prev_${skill}`));
  }
  renameSync(stageDir, liveDir);
}

/** Prune retired skills: local top-level stelow-* dirs missing upstream.
 * Anything not starting with stelow- is never touched (not ours). */
function pruneRetiredSkills(absTarget, bySkill, result) {
  for (const entry of readdirSync(absTarget, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("stelow-")) continue;
    if (entry.name in bySkill) continue;
    try {
      rmSync(join(absTarget, entry.name), { recursive: true, force: true });
      result.removed.push(`${entry.name}/`);
    } catch (e) { result.errors.push(`rm ${entry.name}: ${e.message}`); }
  }
}

/** Sync local core skills to one immutable upstream commit. */
export async function syncWorkflowSkills(targetDir, { ref, log = () => {}, statePath } = {}) {
  const result = { changed: false, updated: [], created: [], removed: [], errors: [] };
  const stateFile = statePath ?? defaultStateFile(targetDir);
  try {
    if (typeof ref !== "string" || !/^[0-9a-f]{40}$/.test(ref)) throw new Error("sync requires an immutable 40-character commit ref");
    const bySkill = groupBySkill(await fetchStelowSkillTree(ref));
    // Sorted for deterministic logs; every upstream stelow-* skill ships.
    const skills = Object.keys(bySkill).sort();
    mkdirSync(targetDir, { recursive: true });
    const absTarget = resolve(targetDir);
    const state = loadState(stateFile);
    const nextState = {};
    // A killed sync can orphan its staging dir; it sits beside skills/
    // (never inside it) and later syncs never touch it.
    const stagingRoot = mkdtempSync(`${absTarget}.staging.`);
    try {
      for (const skill of skills) {
        await stageSkill({ skill, remoteFiles: bySkill[skill], absTarget, stagingRoot, state, nextState, result, ref });
      }
      pruneRetiredSkills(absTarget, bySkill, result);
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

async function syncExecutionAssets({ blobs, source, state, repoRoot, log, result }) {
  const wanted = blobs
    .filter(({ path }) => EXECUTION_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const blob of wanted) {
    if (state[blob.path] === blob.sha) continue;
    try {
      const content = await fetchVerifiedBlob(source.commit, blob.path, blob.sha);
      const abs = join(repoRoot, "data", "stelow-assets", blob.path);
      const existed = existsSync(abs);
      mkdirSync(dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp.${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, abs);
      state[blob.path] = blob.sha;
      (existed ? result.updated : result.created).push(blob.path);
      log(`stelow asset sync: ${blob.path} ${existed ? "updated" : "created"}`);
    } catch (error) {
      result.errors.push(`${blob.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

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
    for (const { repoPath, stateKey, localRel, optional = false } of SINGLE_FILES) {
      const entry = blobs.find((b) => b.path === repoPath);
      assertSingleFilePresent(entry, { repoPath, optional, log });
      if (!entry) continue;
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
    await syncExecutionAssets({ blobs, source, state, repoRoot, log, result });
    if (result.errors.length === 0) state[SYNC_TIMESTAMP_KEY] = Date.now();
    saveState(stateFile, state);
    result.changed = dirty;
    return result;
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }
}
