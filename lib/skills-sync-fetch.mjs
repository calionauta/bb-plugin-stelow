import { createHash } from "node:crypto";

/**
 * Fetch phase of the release-time Stelow sync: every GitHub read lives
 * here, so the diff and swap phases below never touch the network.
 * Runtime code never imports this module: a published plugin executes the
 * helper and skills it shipped, rather than adopting upstream main.
 */

export const REPO = "calionauta/stelow";
export const SRC_PREFIX = "skills/";

export const TREE_URL = (ref) => `https://api.github.com/repos/${REPO}/git/trees/${ref}?recursive=1`;
export const RAW_URL = (ref, path) => `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;

/**
 * Git blob sha of fetched bytes ("blob <len>\0<content>").
 * The raw CDN can serve a stale blob right after a push while the tree API
 * already reports the new sha; writing it would pin stale content under a
 * fresh sha forever (future syncs skip by sha match). Verify before writing.
 */
export function gitBlobSha(content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest("hex");
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
export async function fetchTreeBlobs(ref) {
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
 * Dynamic discovery (not the CORE_SKILLS allowlist, which only scopes
 * worker-context injection): new upstream skills arrive automatically,
 * retired ones vanish from the tree and get pruned by the caller.
 */
export async function fetchStelowSkillTree(ref) {
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
export async function fetchVerifiedBlob(ref, repoPath, sha) {
  const res = await fetch(RAW_URL(ref, repoPath), { headers: { "User-Agent": "bb-plugin-stelow-sync" } });
  if (!res.ok) throw new Error(`fetch ${repoPath}: ${res.status}`);
  const content = Buffer.from(await res.arrayBuffer());
  if (gitBlobSha(content) !== sha) throw new Error(`stale ${repoPath}: content sha mismatch, will retry next sync`);
  return content;
}
