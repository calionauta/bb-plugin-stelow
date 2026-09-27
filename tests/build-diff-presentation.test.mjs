import assert from "node:assert/strict";
import {
  commitFileState,
  formatAffectedTests,
  formatChangedSymbols,
  formatEntitySummary,
  formatQualityGate,
  formatTestGate,
  shouldShowBuildDiff,
} from "../lib/build-diff-presentation.mjs";

const visibility = (overrides = {}) => shouldShowBuildDiff({ status: "working", stage: "analysis", publicationDirty: false, recoveryKind: null, ...overrides });
assert.equal(visibility({ stage: "diff-gate" }), true, "working cards expose pending changes at the diff gate");
assert.equal(visibility({ stage: "audit" }), true, "working cards expose pending changes at audit");
assert.equal(visibility(), false, "unrelated working stages do not expose a diff instrument");
assert.equal(visibility({ status: "completed", stage: "done" }), false, "clean completed cards leave history to Git changes");
assert.equal(visibility({ status: "completed", stage: "done", publicationDirty: true }), true, "a completed tree that became dirty reopens pending review");
assert.equal(visibility({ status: "completed", stage: "done", recoveryKind: "attached" }), true, "an attached recovery checkout needs diff review");

assert.equal(formatEntitySummary({ total: 5, fileCount: 2, added: 1, modified: 1, deleted: 1, renamed: 1, moved: 1, cosmeticOnly: false }), "5 entities · 1 added · 1 modified · 1 deleted · 1 renamed · 1 moved");
assert.equal(formatEntitySummary({ total: 1, fileCount: 1, added: 0, modified: 0, deleted: 0, renamed: 0, moved: 0, cosmeticOnly: true }), "1 entity · cosmetic only");
assert.equal(formatEntitySummary(null), null, "an absent semantic summary does not block patch review");
assert.equal(formatChangedSymbols([{ symbol: "parseCard", callers: 3, testCallers: 2 }, { symbol: "orphan", callers: 0, testCallers: 0 }]), "parseCard · 3 callers (2 tests); orphan · no callers");
assert.equal(formatChangedSymbols(null), null, "an absent impact list is omitted");
assert.equal(formatChangedSymbols([]), null, "an empty impact list is omitted");

const commitFile = {
  binary: false,
  patch: "diff --git a/file b/file",
  loadMode: "initial",
};
assert.equal(commitFileState(commitFile), "", "renderable commit files need no state suffix");
assert.equal(
  commitFileState({ ...commitFile, binary: true, patch: null }),
  " · binary",
  "binary commit files are labeled even when no patch exists",
);
assert.equal(
  commitFileState({ ...commitFile, patch: null, loadMode: "too_large" }),
  " · too large",
  "oversized commit files remain distinct from missing patches",
);
assert.equal(
  commitFileState({ ...commitFile, patch: null, loadMode: "initial" }),
  " · no patch",
  "missing commit patches receive an honest state label",
);

assert.equal(formatAffectedTests(null), null, "an absent affected-test list is omitted");
assert.equal(formatAffectedTests(undefined), null, "an undefined affected-test list is omitted");
assert.equal(formatAffectedTests("x"), null, "a non-list affected-test value is omitted");
assert.equal(formatAffectedTests({}), null, "a non-list affected-test object is omitted");
assert.equal(formatAffectedTests([]), null, "an empty affected-test list is omitted");
const affectedPair = formatAffectedTests([{ name: "covers foo", file: "t.ts" }, { name: "bar", file: "b.ts" }]);
assert.ok(
  typeof affectedPair === "string" &&
    affectedPair.includes("covers foo") &&
    affectedPair.includes("t.ts") &&
    affectedPair.includes("bar") &&
    affectedPair.includes("b.ts"),
  "paired affected tests name each test and its file",
);
const affectedMany = Array.from({ length: 7 }, (_, i) => ({ name: `test-${i}`, file: `f-${i}.ts` }));
const affectedOverflow = formatAffectedTests(affectedMany);
assert.ok(
  typeof affectedOverflow === "string" && affectedOverflow.includes("+2 more") && affectedOverflow.includes("test-0"),
  "long affected-test lists truncate with a remainder count",
);

assert.equal(formatTestGate(null), null, "an absent test gate is omitted");
assert.equal(formatTestGate(undefined), null, "an undefined test gate is omitted");
assert.equal(formatTestGate([]), null, "a non-object test gate is omitted");
assert.equal(formatTestGate({}), null, "an empty test gate is omitted");
const pendingGate = formatTestGate({ tests: 3, untested: 1, testsToRun: ["a", "b"], obligations: true });
assert.ok(
  typeof pendingGate === "string" && pendingGate.includes("a") && pendingGate.includes("b") && pendingGate.includes("1"),
  "a pending test gate names the tests to run and the untested count",
);
const cleanGate = formatTestGate({ tests: 3, untested: 0, testsToRun: [], obligations: false });
assert.ok(
  typeof cleanGate === "string" && cleanGate.includes("3") && cleanGate.includes("no pending obligations"),
  "a clean test gate reports coverage with no pending obligations",
);

assert.equal(formatQualityGate(null), null, "an absent quality gate is omitted");
assert.equal(formatQualityGate(undefined), null, "an undefined quality gate is omitted");
assert.equal(formatQualityGate([]), null, "a non-object quality gate is omitted");
const regressedGate = formatQualityGate({ baseline: "git-HEAD", regressions: 2, minor: 0, gating: 1, blocked: true });
assert.ok(
  typeof regressedGate === "string" && regressedGate.includes("2") && regressedGate.includes("1"),
  "a regressed quality gate reports regression and gating counts",
);
const passingGate = formatQualityGate({ regressions: 0, minor: 0, gating: 0, blocked: false });
assert.ok(
  typeof passingGate === "string" && passingGate.includes("no new regressions"),
  "a passing quality gate reports no new regressions",
);

console.log("build diff presentation test ok: visibility, summaries, caller impact, file states, affected tests, and gates remain intact");
