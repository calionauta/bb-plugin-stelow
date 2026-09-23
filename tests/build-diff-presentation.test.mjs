import assert from "node:assert/strict";
import { formatChangedSymbols, formatEntitySummary, shouldShowBuildDiff } from "../lib/build-diff-presentation.mjs";

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

console.log("build diff presentation test ok: visibility, summaries, and caller impact remain intact");
