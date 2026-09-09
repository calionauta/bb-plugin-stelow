import assert from "node:assert/strict";
import {
  researchRoundMirrorsIndex,
  isValidRoundContent,
  isValidExploreContent,
  exploreArtifactFile,
  findInvalidRounds,
} from "../lib/research-artifacts.mjs";

const INDEX = "# Research index\n\n## Opportunities\n\n- [ ] Something\n";
const ROUND = `# Opportunity mapping — round 1\n\n${"Real playbook output with substance. ".repeat(20)}`;

// Mirroring: identical content or the index heading shape means the playbook
// output never landed in the round file.
assert.equal(researchRoundMirrorsIndex(INDEX, INDEX), true, "identical content mirrors");
assert.equal(researchRoundMirrorsIndex("# Research index\n\nmy notes", INDEX), true, "index heading mirrors");
assert.equal(researchRoundMirrorsIndex(ROUND, INDEX), false, "real output does not mirror");
assert.equal(researchRoundMirrorsIndex(null, INDEX), false, "missing content does not mirror");
assert.equal(researchRoundMirrorsIndex(ROUND, null), false, "no index means no mirror verdict");

// Validity: non-empty + minimum substance + not a mirror.
assert.equal(isValidRoundContent(ROUND, INDEX), true, "real round is valid");
assert.equal(isValidRoundContent("", INDEX), false, "empty round is invalid");
assert.equal(isValidRoundContent("short", INDEX), false, "thin round is invalid");
assert.equal(isValidRoundContent(INDEX, INDEX), false, "mirrored round is invalid");
assert.equal(isValidRoundContent(null, INDEX), false, "missing round is invalid");

// Explore: single file, no index to mirror — presence + substance only.
assert.equal(isValidExploreContent("# Shape Up\n\n" + "x".repeat(300)), true, "real explore artifact is valid");
assert.equal(isValidExploreContent(""), false, "empty explore artifact is invalid");
assert.equal(isValidExploreContent("thin"), false, "thin explore artifact is invalid");
assert.equal(isValidExploreContent("", null), false, "explicit null threshold still invalid");
assert.equal(exploreArtifactFile("shape-up"), "explore-shape-up.md", "explore file convention");

// Scan: every invalid round is named in order; valid rounds never surface.
const history = [
  { id: "a", at: "t1", file: "rounds/a-r1.md" },
  { id: "b", at: "t2", file: "rounds/b-r2.md" },
  { id: "c", at: "t3", file: "rounds/c-r3.md" },
];
const files = { "rounds/a-r1.md": ROUND, "rounds/b-r2.md": INDEX, "rounds/c-r3.md": "" };
const invalid = findInvalidRounds(history, (path) => files[path] ?? null, INDEX, (id) => ({ a: "A", b: "B", c: "C" })[id] ?? null);
assert.deepEqual(invalid, [{ n: 2, label: "B" }, { n: 3, label: "C" }], "invalid rounds named in order");
assert.deepEqual(findInvalidRounds([], () => null, INDEX, null), [], "empty history is clean");

console.log("research artifacts test ok: mirror detection, validity, integrity scan");
