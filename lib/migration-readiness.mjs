// Pure decision helpers for the 0.3 → current-line migration (v0.3.84+).
// Kept dependency-free and unit-tested so the readiness gates never silently
// misbehave again — parseSemverParts once anchored at the start of the
// string, which rejected floors like ">=0.38" (engines.bb's real shape) and
// made the bb-too-old gate block everyone.

export function parseSemverParts(value) {
  const match = /v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), match[3] === undefined ? 0 : Number(match[3])];
}

export function versionAtLeast(version, floor) {
  const versionParts = parseSemverParts(version);
  const floorParts = parseSemverParts(floor);
  if (!versionParts || !floorParts) return false;
  for (let index = 0; index < 3; index += 1) {
    if (versionParts[index] !== floorParts[index]) return versionParts[index] > floorParts[index];
  }
  return true;
}

// True when a marketplace entry range already covers the modern line
// (floor >= 0.18.0). Conservative on purpose: anything ambiguous is false,
// which only disables the automatic path and falls back to manual.
export function stelowRangeCoversCurrentLine(range) {
  const match = /^>=\s*(\d+)\.(\d+)/.exec(String(range ?? "").trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 18;
}

// Highest tag name whose version satisfies the floor, from `git ls-remote
// --tags` output lines. Returns null when none satisfies. Ignores peeled
// (`^{}`) lines and non-v-prefixed tags.
export function highestSatisfyingTag(lsRemoteOutput, floor) {
  const candidates = [];
  for (const line of String(lsRemoteOutput ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.includes("^{}")) continue;
    const tagMatch = /refs\/tags\/(.+)$/.exec(trimmed);
    if (!tagMatch) continue;
    const tag = tagMatch[1];
    if (!tag.startsWith("v")) continue;
    const version = parseSemverParts(tag);
    if (version === null) continue;
    if (!versionAtLeast(tag, floor)) continue;
    candidates.push({ tag, version });
  }
  candidates.sort((left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left.version[index] !== right.version[index]) return right.version[index] - left.version[index];
    }
    return 0;
  });
  return candidates.length === 0 ? null : candidates[0].tag;
}