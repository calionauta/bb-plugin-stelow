/**
 * A pre-1.0 line must not be able to publish 1.0.0 by accident.
 *
 * Release-please computes 1.0.0 for a `BREAKING CHANGE:` on a 0.x line, and
 * this workflow passes `release-type` on the action, so the config file that
 * could soften that to a minor bump is never read. A consolidating PR carrying
 * a breaking footer proposed 1.0.0 on this repo and it was caught by a human
 * reading the proposed version. This pins the refusal so it does not depend on
 * that reading.
 *
 * The regression pinned: a 0.x line with an open release PR proposing a major
 * version passes as healthy.
 */
import assert from "node:assert/strict";
import { classifyMajorClaim, describeMajorClaim } from "../lib/release-major-claim.mjs";

// The regression: master on 0.x, an open release PR claiming 1.0.0.
const claim = classifyMajorClaim({ version: "0.61.1", openReleaseVersions: ["1.0.0"] });
assert.equal(claim.state, "major-claim", "a 1.0.0 proposal on a 0.x line is refused");
assert.match(claim.reason, /1\.0\.0/, "the reason names the version that would ship");
assert.match(claim.reason, /0\.61\.1/, "the reason names the version being left behind");
assert.match(claim.reason, /nobody has claimed/, "the reason states why a major claim is wrong here");

// A refusal with no door is a trap, so the remedy is part of the behaviour.
assert.match(claim.remedy, /release-as/, "the refusal names the release-as input as the way through");
assert.match(claim.remedy, /never edit the version/i, "the refusal rules out the edit that does not hold");

// Any major is equally unearned on a 0.x line, not just 1.0.0.
assert.equal(
  classifyMajorClaim({ version: "0.61.1", openReleaseVersions: ["2.0.0"] }).state,
  "major-claim",
  "a 2.0.0 proposal on a 0.x line is refused",
);
assert.equal(
  classifyMajorClaim({ version: "0.61.1", openReleaseVersions: ["0.62.0", "3.0.0"] }).state,
  "major-claim",
  "a major claim is caught alongside an ordinary minor proposal",
);

// The states that must NOT fire, or this blocks every ordinary release.
assert.equal(classifyMajorClaim({ version: "0.61.1", openReleaseVersions: [] }).state, "in-line", "no open release PR is not a claim");
assert.equal(classifyMajorClaim({ version: "0.61.1" }).state, "in-line", "an absent open list is not a claim");
assert.equal(
  classifyMajorClaim({ version: "0.61.1", openReleaseVersions: ["0.62.0"] }).state,
  "in-line",
  "an ordinary minor release passes",
);
assert.equal(
  classifyMajorClaim({ version: "0.61.1", openReleaseVersions: ["0.61.2"] }).state,
  "in-line",
  "an ordinary patch release passes",
);

// Past 1.0.0 a major bump is the normal case and must never be refused.
assert.equal(
  classifyMajorClaim({ version: "1.2.0", openReleaseVersions: ["2.0.0"] }).state,
  "in-line",
  "a major bump after 1.0.0 is ordinary and is not refused",
);

// Unreadable input is never evidence of a claim: a typo must not block a release.
assert.equal(classifyMajorClaim({ version: "", openReleaseVersions: ["1.0.0"] }).state, "in-line", "an unreadable master version never fires");
assert.equal(classifyMajorClaim({ version: "not-a-version" }).state, "in-line", "a non-version master never fires");
assert.equal(
  classifyMajorClaim({ version: "0.61.1", openReleaseVersions: ["garbage"] }).state,
  "in-line",
  "an unreadable proposed version is not a claim",
);

// Prefixed tags come from PR titles and must still be read.
assert.equal(
  classifyMajorClaim({ version: "0.61.1", openReleaseVersions: ["v1.0.0"] }).state,
  "major-claim",
  "the v prefix on a proposed version does not hide a major claim",
);
assert.equal(
  classifyMajorClaim({ version: "0.61.1", openReleaseVersions: ["1.0.0-rc.1"] }).state,
  "major-claim",
  "a prerelease of a major is still a major claim",
);

// The annotation leads with the state, like the published-version guard.
assert.match(describeMajorClaim(claim), /^release claim: major-claim — /, "annotation leads with the state");
assert.match(
  describeMajorClaim(classifyMajorClaim({ version: "0.61.1", openReleaseVersions: [] })),
  /in-line/,
  "annotation names the healthy state",
);

console.log("release-major-claim ok: a 0.x line cannot publish a major version unnoticed, and ordinary releases pass");
