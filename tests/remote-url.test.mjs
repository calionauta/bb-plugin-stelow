import assert from "node:assert/strict";
import { branchWebLinks, parsePushRemoteUrl } from "../lib/remote-url.mjs";

assert.equal(parsePushRemoteUrl(null), null, "null input yields no remote");
assert.equal(parsePushRemoteUrl(""), null, "empty input yields no remote");
const https = parsePushRemoteUrl("To https://github.com/calionauta/bb-plugin-stelow.git");
assert.deepEqual(
  https,
  { owner: "calionauta", repo: "calionauta/bb-plugin-stelow", webUrl: "https://github.com/calionauta/bb-plugin-stelow" },
  "https push lines yield owner, repo, and web URL",
);

const ssh = parsePushRemoteUrl("To git@github.com:calionauta/bb-plugin-stelow.git");
assert.deepEqual(ssh, https, "ssh push lines normalize to the same remote");

assert.equal(parsePushRemoteUrl("To https://gitlab.com/acme/app.git"), null, "non-GitHub hosts yield no links");
assert.equal(parsePushRemoteUrl("Everything up-to-date"), null, "output without a To line yields no remote");

const links = branchWebLinks(https, "feature-x", "master");
assert.deepEqual(
  links,
  {
    treeUrl: "https://github.com/calionauta/bb-plugin-stelow/tree/feature-x",
    compareUrl: "https://github.com/calionauta/bb-plugin-stelow/compare/master...feature-x?expand=1",
  },
  "branch and base yield tree and compare links",
);
assert.equal(branchWebLinks(https, "master", "master")?.compareUrl, null, "same branch and base yield no compare link");
assert.equal(branchWebLinks(null, "master", "main"), null, "no remote yields no links");
assert.equal(branchWebLinks(https, null, "main"), null, "no branch yields no links");

console.log("remote url test ok: push output yields GitHub branch links");
