import assert from "node:assert/strict";
import { compareReleaseTags, fetchLatestPluginRelease, isNewerRelease, parseReleaseTag } from "../lib/github-release.mjs";

// Tag parsing: optional v, numeric triple, prerelease suffix tolerated.
assert.deepEqual(parseReleaseTag("v0.22.0"), { major: 0, minor: 22, patch: 0 }, "v-prefixed tag parses");
assert.deepEqual(parseReleaseTag("0.21.0"), { major: 0, minor: 21, patch: 0 }, "bare tag parses");
assert.deepEqual(parseReleaseTag("v1.2.3-alpha.1"), { major: 1, minor: 2, patch: 3 }, "prerelease suffix parses");
assert.equal(parseReleaseTag("dev"), null, "dev is not a tag");
assert.equal(parseReleaseTag("4450336f"), null, "sha is not a tag");
assert.equal(parseReleaseTag(null), null, "null is not a tag");

// Comparison drives the "published on GitHub" line.
assert.equal(compareReleaseTags("0.21.0", "v0.22.0"), -1, "older sorts first across v-prefix");
assert.equal(compareReleaseTags("v0.22.0", "0.22.0"), 0, "prefix-insensitive equality");
assert.equal(compareReleaseTags("0.22.0", "0.21.0"), 1, "newer sorts last");
assert.equal(compareReleaseTags("dev", "v0.22.0"), 0, "garbage never compares");
assert.equal(isNewerRelease("0.21.0", "v0.22.0"), true, "behind install discovers the release");
assert.equal(isNewerRelease("0.22.0", "v0.22.0"), false, "current install shows nothing");
assert.equal(isNewerRelease("dev", "v0.22.0"), false, "dev build never claims an upgrade");
assert.equal(isNewerRelease(null, "v0.22.0"), false, "missing version never claims an upgrade");

// Fetch shaping: fail-soft everywhere, strict URL gate for the href.
const release = { tag_name: "v0.22.0", html_url: "https://github.com/calionauta/bb-plugin-stelow/releases/tag/v0.22.0" };
const okFetch = async () => ({ ok: true, json: async () => release });
assert.deepEqual(await fetchLatestPluginRelease(okFetch), { tag: "v0.22.0", url: release.html_url }, "release shapes to tag+url");
assert.equal(await fetchLatestPluginRelease(async () => ({ ok: false, status: 404 })), null, "HTTP error reads as unknown");
assert.equal(await fetchLatestPluginRelease(async () => { throw new Error("offline"); }), null, "network failure reads as unknown");
assert.equal(
  await fetchLatestPluginRelease(async () => ({ ok: true, json: async () => ({ ...release, html_url: "javascript:alert(1)" }) })),
  null,
  "foreign href never reaches the panel",
);
assert.equal(
  await fetchLatestPluginRelease(async () => ({ ok: true, json: async () => ({ ...release, tag_name: "not-a-version" }) })),
  null,
  "non-version tag never reaches the panel",
);

console.log("github release test ok: tag parsing, comparison, fail-soft discovery");
