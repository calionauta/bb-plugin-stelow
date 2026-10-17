#!/usr/bin/env node
// CI upstream-first gate: every vendored Stelow path must match the pinned
// upstream commit, unless data/upstream-forks.json names it with a reason.
// Compares tree shas (one API call, no downloads) against local git-blob
// shas — the same digest both sides, so equality is byte-identity.
// Exit 0 clean (or offline skip after schema validation), 1 unlisted drift,
// 2 usage/allowlist error. Offline skips like the sync tests: the network
// failure this guards against is the sync's normal fail-soft path.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTreeBlobs } from "../lib/skills-sync-fetch.mjs";
import {
  EXECUTION_ASSET_PREFIXES, SINGLE_FILES, applyAllowlist, diffFileMaps,
  localGitBlobSha, readPinnedStelowSource, readUpstreamForks, walk,
} from "../lib/skills-sync-diff.mjs";

const UNAVAILABLE = /(403|429|50\d)\b|fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|offline|timeout|unreachable|socket|getaddrinfo/i;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Upstream tree reduced to the paths the sync owns. */
function collectRemoteMap(blobs) {
  const remote = new Map();
  for (const { path, sha } of blobs) {
    if (path.startsWith("skills/")) {
      const slash = path.indexOf("/", "skills/".length);
      if (slash === -1) continue;
      if (!path.slice("skills/".length, slash).startsWith("stelow-")) continue;
      remote.set(path, sha);
      continue;
    }
    if (SINGLE_FILES.some((spec) => spec.repoPath === path)) remote.set(path, sha);
    if (EXECUTION_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))) remote.set(path, sha);
  }
  return remote;
}

/** Local vendored tree as repoPath→sha: skills plus every synced data copy.
 * An optional single file absent upstream is preserved locally by the sync,
 * so it is invisible to the gate; a required path missing locally is
 * reported as missing-local rather than a hash mismatch. */
function collectLocalMap(remote) {
  const local = new Map();
  const missing = [];
  const skillsDir = join(root, "skills");
  for (const { rel, abs } of walk(skillsDir)) {
    const [skill] = rel.split("/");
    if (!skill.startsWith("stelow-")) continue;
    local.set(`skills/${rel}`, localGitBlobSha(abs));
  }
  for (const { repoPath, localRel, optional = false } of SINGLE_FILES) {
    if (!remote.has(repoPath) && optional) continue;
    const abs = join(root, localRel);
    if (!existsSync(abs)) {
      missing.push({ path: repoPath, kind: "missing-local" });
      continue;
    }
    local.set(repoPath, localGitBlobSha(abs));
  }
  const assetsDir = join(root, "data", "stelow-assets");
  if (existsSync(assetsDir)) {
    for (const { rel, abs } of walk(assetsDir)) {
      const owned = EXECUTION_ASSET_PREFIXES.some((prefix) => rel.startsWith(prefix));
      if (owned) local.set(rel, localGitBlobSha(abs));
    }
  }
  return { local, missing };
}

try {
  const source = readPinnedStelowSource(root);
  const allowlist = readUpstreamForks(root);
  if (allowlist.pin !== source.commit) {
    console.error(`drift gate misconfigured: allowlist pin ${allowlist.pin} != source pin ${source.commit}`);
    process.exit(2);
  }
  let blobs;
  try {
    blobs = await fetchTreeBlobs(source.commit);
  } catch (error) {
    if (!UNAVAILABLE.test(String(error?.message ?? error))) throw error;
    console.log(`upstream drift check SKIPPED (upstream unreachable); allowlist schema valid for pin ${source.commit.slice(0, 12)}`);
    process.exit(0);
  }
  const remote = collectRemoteMap(blobs);
  const { local, missing } = collectLocalMap(remote);
  const { listed, unlisted, stale } = applyAllowlist([...missing, ...diffFileMaps(local, remote)], allowlist);
  for (const entry of listed) console.log(`  allowlisted ${entry.kind} ${entry.path} — ${entry.reason.slice(0, 80)}`);
  for (const path of stale) console.log(`  stale allowlist entry (drift healed upstream, drop it): ${path}`);
  if (unlisted.length > 0) {
    for (const entry of unlisted) console.error(`  UNLISTED DRIFT ${entry.kind} ${entry.path}`);
    console.error(`upstream drift: ${unlisted.length} unlisted path(s) differ from pin ${source.commit.slice(0, 12)}`);
    console.error("declare each in data/upstream-forks.json or sync the tree");
    process.exit(1);
  }
  console.log(`upstream drift check ok: vendored tree matches pin ${source.commit.slice(0, 12)} (${listed.length} allowlisted)`);
} catch (error) {
  console.error(`upstream drift check FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
