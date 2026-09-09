import assert from "node:assert/strict";
import {
  researchRoundMirrorsIndex,
  isValidRoundContent,
  isValidExploreContent,
  exploreArtifactFile,
  findInvalidRounds,
  researchVerifyReport,
  researchVerifyText,
  exploreVerifyReport,
  exploreVerifyText,
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

// Verify reports: PASS needs a reviewable index AND zero invalid rounds —
// the same verdict the sync gate, the CLI, and the prompt all share.
const passReport = researchVerifyReport("card_1", 2, true, []);
assert.equal(passReport.pass, true, "clean rounds pass");
assert.deepEqual(researchVerifyText(passReport), { exitCode: 0, stdout: "PASS: research card_1 — index reviewable, all 2 round file(s) valid." }, "pass text");
assert.deepEqual(researchVerifyReport("card_1", 2, true, [{ n: 2, label: "B" }]).pass, false, "invalid round fails even with reviewable index");
const failRounds = researchVerifyText(researchVerifyReport("card_1", 2, true, [{ n: 2, label: "B" }]));
assert.equal(failRounds.exitCode, 1, "round failure exits 1");
assert.match(failRounds.stderr, /FAIL round 2 \(B\)/, "round failure names the round");
const failIndex = researchVerifyText(researchVerifyReport("card_1", 0, false, []));
assert.equal(failIndex.exitCode, 1, "unreviewable index exits 1");
assert.match(failIndex.stderr, /not reviewable yet/, "index failure names the index");

const explorePass = exploreVerifyReport("card_9", "shape-up", true);
assert.equal(explorePass.pass, true, "real explore artifact passes");
assert.deepEqual(exploreVerifyText(explorePass), { exitCode: 0, stdout: "PASS: explore card_9 — explore-shape-up.md holds the stage deliverable." }, "explore pass text");
const exploreFail = exploreVerifyText(exploreVerifyReport("card_9", "shape-up", false));
assert.equal(exploreFail.exitCode, 1, "thin explore artifact exits 1");
assert.match(exploreFail.stderr, /explore-shape-up\.md is missing or thin/, "explore failure names the file");

console.log("research artifacts test ok: mirror detection, validity, integrity scan, verify reports");
