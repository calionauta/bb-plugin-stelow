import assert from "node:assert/strict";
import { formatChangedSymbols, formatEntitySummary } from "../lib/build-diff-presentation.mjs";

assert.equal(formatEntitySummary({ total: 3, fileCount: 2, added: 1, modified: 1, deleted: 1, renamed: 0, moved: 0, cosmeticOnly: false }), "3 entities · 1 added · 1 modified · 1 deleted");
assert.equal(formatEntitySummary({ total: 1, fileCount: 1, added: 0, modified: 0, deleted: 0, renamed: 0, moved: 0, cosmeticOnly: true }), "1 entity · cosmetic only");
assert.equal(formatEntitySummary(null), null, "an absent semantic summary does not block patch review");
assert.equal(formatChangedSymbols([{ symbol: "parseCard", callers: 1, testCallers: 1 }, { symbol: "orphan", callers: 0, testCallers: 0 }]), "parseCard · 1 caller (1 test); orphan · no callers");
assert.equal(formatChangedSymbols([]), null, "an empty impact list is omitted");

console.log("build diff presentation test ok: summaries preserve entity and caller impact context");
