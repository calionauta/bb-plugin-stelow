/**
 * Is the version on master actually published?
 *
 * Release-please can fail to recognise that its own release pull request was
 * merged, and when it does it says nothing actionable: it reports no baseline,
 * diffs from the beginning of history, and opens a *new* release pull request
 * that re-lists months of already-shipped features. That is not a cosmetic
 * failure — a merged release bump with no tag leaves every install unable to
 * move forward, and nothing in the build goes red.
 *
 * This classifies the one state that must never pass quietly: master carries a
 * version that has no tag and no open release pull request for it. The other
 * two states are healthy and must not be flagged:
 *
 * - `released` — master is at the newest published tag. This is the normal
 *   state for every feature push, because release-please does not bump master
 *   until its release PR merges. Flagging this would make the check fire on
 *   every commit.
 * - `pending` — a release pull request exists for that version, so the bump
 *   is still in flight. This is the normal state between opening the release
 *   PR and merging it.
 *
 * Pure, so the states are exercised in node tests rather than only in CI.
 */

import { compareReleaseTags } from "./github-release.mjs";

/**
 * @param {object} input
 * @param {string} input.version        version in package.json on master
 * @param {string|null} input.latestTag newest published tag, or null if none
 * @param {string[]} [input.openReleaseVersions] versions with an open release PR
 * @returns {{state: "released"|"pending"|"unpublished", reason: string}}
 */
export function classifyReleaseState({ version, latestTag, openReleaseVersions = [] }) {
  if (typeof version !== "string" || !version.trim()) {
    return { state: "released", reason: "no version to check" };
  }

  // No tag at all is a first release, not a broken one.
  if (typeof latestTag !== "string" || !latestTag.trim()) {
    return { state: "released", reason: "no published tag yet" };
  }

  if (compareReleaseTags(version, latestTag) === 0) {
    return { state: "released", reason: `master is at the published tag ${latestTag}` };
  }

  if (compareReleaseTags(version, latestTag) < 0) {
    // master is behind the newest release: an unmerged release branch, or a
    // checkout that was reset. Not this check's business.
    return { state: "released", reason: `master (${version}) is behind ${latestTag}` };
  }

  const wanted = version.replace(/^v/, "");
  const open = openReleaseVersions.some((candidate) => {
    const bare = String(candidate ?? "").trim().replace(/^v/, "");
    return bare === wanted;
  });
  if (open) {
    return { state: "pending", reason: `a release pull request for ${wanted} is still open` };
  }

  return {
    state: "unpublished",
    reason:
      `master is at ${wanted} but the newest tag is ${latestTag}, and no open release ` +
      `pull request accounts for it. The release pull request was merged without ` +
      `publishing a tag, so installs cannot move to ${wanted}.`,
  };
}

/** One line, written for a CI annotation. */
export function describeReleaseState(result) {
  return `release state: ${result.state} — ${result.reason}`;
}
