/**
 * A merged release bump that never produced a tag is invisible to every build.
 *
 * Release-please recognised its own release pull request on every release up to
 * v0.56.4. On v0.57.0 the release PR body had been rewritten by hand, so the
 * action could no longer parse it as its own ("could not parse pull request body
 * as a release PR"), reported no baseline, and opened a 0.58.0 that re-listed
 * months of shipped work. Master sat at 0.57.0 with no tag and nothing red.
 *
 * The regression this pins is that silent state: master ahead of the newest
 * tag with no release pull request open to explain it.
 */
import assert from "node:assert/strict";
import { classifyReleaseState, describeReleaseState } from "../lib/release-published.mjs";

// The healthy state, and the one that must never fail: every ordinary feature
// push leaves master at the published version, because release-please does not
// bump master until its release PR merges.
assert.equal(classifyReleaseState({ version: "0.57.0", latestTag: "v0.57.0" }).state, "released", "master at the tag is released");
assert.equal(classifyReleaseState({ version: "0.57.0", latestTag: "0.57.0" }).state, "released", "tag prefix is ignored");
assert.equal(classifyReleaseState({ version: "0.57.0", latestTag: "v0.57.0-alpha" }).state, "released", "same triple with a suffix compares equal");

// A release PR in flight is healthy: the bump is still coming.
assert.equal(
  classifyReleaseState({ version: "0.58.0", latestTag: "v0.57.0", openReleaseVersions: ["0.58.0"] }).state,
  "pending",
  "an open release PR for the version is pending, not broken",
);
assert.equal(
  classifyReleaseState({ version: "0.58.0", latestTag: "v0.57.0", openReleaseVersions: ["v0.58.0"] }).state,
  "pending",
  "open version tolerates the v prefix",
);
assert.equal(
  classifyReleaseState({ version: "0.58.0", latestTag: "v0.57.0", openReleaseVersions: ["0.59.0"] }).state,
  "unpublished",
  "an open PR for a different version does not explain this one",
);

// The regression: master bumped, nothing published, nothing open. This is the
// exact v0.57.0 state, and the reason the guard exists.
const broken = classifyReleaseState({ version: "0.57.0", latestTag: "v0.56.4", openReleaseVersions: [] });
assert.equal(broken.state, "unpublished", "merged bump with no tag and no open PR is unpublished");
assert.match(broken.reason, /0\.57\.0/, "the reason names the stranded version");
assert.match(broken.reason, /v0\.56\.4/, "the reason names the tag installs are stuck on");
assert.match(broken.reason, /installs cannot move/, "the reason states the user-visible cost");

// Cases that must not be reported as broken.
assert.equal(classifyReleaseState({ version: "0.56.0", latestTag: "v0.57.0" }).state, "released", "master behind the tag is not this failure");
assert.equal(classifyReleaseState({ version: "0.57.0", latestTag: null }).state, "released", "no tag at all is a first release");
assert.equal(classifyReleaseState({ version: "", latestTag: "v0.57.0" }).state, "released", "an unreadable version never fails the build");
assert.equal(classifyReleaseState({ version: "0.57.0", latestTag: "" }).state, "released", "an unreadable tag never fails the build");
assert.equal(classifyReleaseState({ version: "0.57.0", latestTag: "v0.57.0", openReleaseVersions: null }).state, "released", "a null open list never throws");

// The annotation is one line and names the state.
assert.match(describeReleaseState(broken), /^release state: unpublished — /, "annotation leads with the state");
assert.match(describeReleaseState(classifyReleaseState({ version: "0.57.0", latestTag: "v0.57.0" })), /released/, "annotation names the healthy state");

console.log("release-published ok: a stranded release bump is reported, a bump in flight is not");
