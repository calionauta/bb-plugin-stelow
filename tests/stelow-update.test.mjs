import assert from "node:assert/strict";
import { checkStelowUpdate, compareStelowVersions, latestStelowRelease } from "../lib/stelow-update.mjs";

assert.ok(compareStelowVersions("0.60.0", "0.59.9-alpha") > 0);
assert.ok(compareStelowVersions("0.59.9", "0.59.9-alpha") > 0);
assert.ok(compareStelowVersions("0.59.9-alpha.2", "0.59.9-alpha.10") < 0);
assert.equal(compareStelowVersions("bad", "0.1.0"), null);
const releases = [{ tag_name: "v0.59.9-alpha", draft: false, html_url: "alpha" }, { tag_name: "v0.60.0", draft: false, html_url: "stable" }, { tag_name: "v9.0.0", draft: true }];
assert.equal(latestStelowRelease(releases).tag_name, "v0.60.0");
const update = await checkStelowUpdate(async () => ({ ok: true, json: async () => releases }));
assert.deepEqual(update, { version: "0.60.0", url: "stable" });
console.log("stelow update test ok: semver ordering and read-only release probe");
