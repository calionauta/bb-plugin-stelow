/**
 * Is a release claiming a major version this line has never earned?
 *
 * On a pre-1.0 line with `release-type` passed on the action, release-please
 * builds its strategy from code (`Manifest.fromConfig`) and never reads
 * `release-please-config.json`, so `bump-minor-pre-major` cannot be switched on
 * from a config file. A `BREAKING CHANGE:` footer therefore takes the major
 * path: a consolidating PR at 0.61.1 proposed 1.0.0, a milestone that asserts
 * API stability nobody has claimed.
 *
 * The remedy is documented and already works — re-run the workflow with
 * `release-as`. What was missing is that nothing *refused* the 1.0.0 first, so
 * the gap depended on a human reading the proposed version closely. This is
 * that refusal, and it names the remedy, because a guard with no door is a trap.
 *
 * Pure, so the decision is exercised in node tests rather than only in CI.
 */

import { parseReleaseTag } from "./github-release.mjs";

/**
 * @param {object} input
 * @param {string} input.version                version in package.json on master
 * @param {string[]} [input.openReleaseVersions] versions proposed by open release PRs
 * @returns {{state: "in-line"|"major-claim", reason: string, remedy: string|null}}
 */
export function classifyMajorClaim({ version, openReleaseVersions = [] }) {
  const current = parseReleaseTag(version);
  const remedy =
    "Re-run the release workflow with its own input: " +
    "`gh workflow run release.yml -f release-as=<version>`. Never edit the version in the " +
    "release pull request, which release-please overwrites.";

  // An unreadable version is not evidence of a major claim. Refusing here would
  // turn a typo into a blocked release.
  if (!current) {
    return { state: "in-line", reason: `master version ${JSON.stringify(version)} is not a release tag`, remedy: null };
  }

  // Past 1.0.0 a major bump is a normal, deliberate release. Nothing to catch.
  if (current.major >= 1) {
    return { state: "in-line", reason: `master is on the ${current.major}.x line, where a major bump is ordinary`, remedy: null };
  }

  const claims = (openReleaseVersions ?? [])
    .map((candidate) => parseReleaseTag(candidate))
    .filter((parsed) => parsed && parsed.major >= 1)
    .map((parsed) => candidate0(parsed));

  if (claims.length === 0) {
    return { state: "in-line", reason: `no open release pull request proposes a major version on the 0.x line`, remedy: null };
  }

  return {
    state: "major-claim",
    reason:
      `master is at ${current.major}.${current.minor}.${current.patch}, but an open release pull request ` +
      `proposes ${claims.join(", ")}. A breaking change on a pre-1.0 line takes the major path unless ` +
      `bump-minor-pre-major is configured, and this workflow passes release-type on the action, which ` +
      `bypasses the config file. Publishing ${claims[0]} would assert an API-stability milestone that ` +
      `nobody has claimed and that no install asked for.`,
    remedy,
  };
}

function candidate0(parsed) {
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/** One line, written for a CI annotation. */
export function describeMajorClaim(result) {
  return `release claim: ${result.state} — ${result.reason}`;
}
