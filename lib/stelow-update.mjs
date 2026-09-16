const RELEASES_URL = "https://api.github.com/repos/calionauta/stelow/releases?per_page=30";

function parseVersion(value) {
  const match = typeof value === "string" && value.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4]?.split(".") ?? [] };
}

function compareIdentifier(left, right) {
  const leftNumber = /^\d+$/.test(left);
  const rightNumber = /^\d+$/.test(right);
  if (leftNumber && rightNumber) return Number(left) - Number(right);
  if (leftNumber) return -1;
  if (rightNumber) return 1;
  return left.localeCompare(right);
}

/** Compare SemVer versions, including prerelease precedence. */
export function compareStelowVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : (a.pre.length === 0 ? 1 : -1);
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    if (a.pre[index] == null) return -1;
    if (b.pre[index] == null) return 1;
    const result = compareIdentifier(a.pre[index], b.pre[index]);
    if (result) return result;
  }
  return 0;
}

/** Select the greatest valid, published GitHub release. */
export function latestStelowRelease(releases) {
  if (!Array.isArray(releases)) return null;
  return releases
    .filter((release) => release && !release.draft && parseVersion(release.tag_name))
    .reduce((latest, release) => !latest || compareStelowVersions(release.tag_name, latest.tag_name) > 0 ? release : latest, null);
}

/** Read-only update probe. It cannot change vendored code or a running workflow. */
export async function checkStelowUpdate(fetchImpl = fetch) {
  const response = await fetchImpl(RELEASES_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "bb-plugin-stelow" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Stelow release check failed: ${response.status}`);
  const release = latestStelowRelease(await response.json());
  if (!release) throw new Error("No valid published Stelow release found.");
  return { version: release.tag_name.replace(/^v/, ""), url: typeof release.html_url === "string" ? release.html_url : null };
}
