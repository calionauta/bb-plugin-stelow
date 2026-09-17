/**
 * Self-release discovery for installs BB cannot update. BB's update check
 * only covers BB-managed sources, so a local checkout can sit behind GitHub
 * releases while the panel says "cannot apply" — and re-checking the same
 * verdict never discovers the new tag. This fail-soft lookup names the
 * newest published release so the panel can point at it honestly.
 *
 * Pure fetch+parse (fetch injectable) so the shaping is exercised in node
 * tests. The server coalesces calls behind its update-check window; a
 * failure keeps the previous value (stale discovery beats none).
 */

const RELEASES_URL = "https://api.github.com/repos/calionauta/bb-plugin-stelow/releases/latest";
const RELEASE_URL_PREFIX = "https://github.com/calionauta/bb-plugin-stelow/releases/";
const FETCH_TIMEOUT_MS = 10_000;
const TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/;

/** Numeric triple of a version tag, or null when it is not one. */
export function parseReleaseTag(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(TAG_PATTERN);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** -1 when a < b, 0 when equal or unparsable, 1 when a > b. */
export function compareReleaseTags(a, b) {
  const pa = parseReleaseTag(a);
  const pb = parseReleaseTag(b);
  if (!pa || !pb) return 0;
  for (const part of ["major", "minor", "patch"]) {
    if (pa[part] !== pb[part]) return pa[part] < pb[part] ? -1 : 1;
  }
  return 0;
}

/** Whether latest is strictly newer than running. Garbage never upgrades. */
export function isNewerRelease(running, latest) {
  if (typeof running !== "string" || typeof latest !== "string") return false;
  return compareReleaseTags(running, latest) < 0;
}

/** Newest published release ({ tag, url }) or null on any failure. */
export async function fetchLatestPluginRelease(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "bb-plugin-stelow-update-check" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    const tag = data && typeof data.tag_name === "string" ? data.tag_name.trim() : "";
    const url = data && typeof data.html_url === "string" ? data.html_url : "";
    if (!parseReleaseTag(tag) || !url.startsWith(RELEASE_URL_PREFIX)) return null;
    return { tag, url };
  } catch {
    return null;
  }
}
