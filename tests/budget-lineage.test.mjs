// Lineage is the evidence the budget gate needs before it may call a finding
// inherited. These are the pure functions behind that decision, tested on their
// own: a move has to be proven by a long contiguous run of tokens, and the
// threshold is a number someone could quietly lower, so it is pinned from both
// sides.
import assert from "node:assert/strict";
import {
  censusKey,
  lineageTokens,
  longestSharedRun,
  pathAffinity,
  provesMove,
  tokenList,
} from "../scripts/budget-lineage.mjs";

function body(count, prefix) {
  return Array.from({ length: count }, (_, index) => `  const ${prefix}${index} = ${prefix}Step(${index});`).join("\n");
}

function source(count, prefix) {
  return `export function ${prefix}Handler(input) {\n${body(count, prefix)}\n  return input;\n}\n`;
}

const legacy = source(50, "alpha");
const moved = source(50, "alpha");
const renamed = source(50, "beta");
const rewritten = source(50, "gamma");

const legacyTokens = tokenList(legacy);
const movedTokens = tokenList(moved);
const renamedTokens = tokenList(renamed);
const rewrittenTokens = tokenList(rewritten);

assert.deepEqual(
  tokenList("const value = 1;\n").slice(0, 4),
  ["const", "value", "=", "1"],
  "the tokenizer must keep identifiers, numbers, and punctuation",
);

assert.equal(
  longestSharedRun(legacyTokens, movedTokens),
  legacyTokens.length,
  "a verbatim move shares its whole token sequence",
);
assert.ok(
  provesMove(legacyTokens, movedTokens),
  "a verbatim move is lineage",
);
assert.equal(
  longestSharedRun(legacyTokens, renamedTokens),
  8,
  "a rename shares the declaration and the first `const` of the body, then diverges",
);
assert.equal(
  longestSharedRun(legacyTokens, rewrittenTokens),
  8,
  "a function written in the same shape shares the declaration, not the body",
);
assert.ok(
  !provesMove(legacyTokens, rewrittenTokens),
  "shared vocabulary is not a move",
);

// The threshold pinned from both sides: 19 shared tokens is a coincidence, 20 is
// a body that travelled. Written as raw tokens so the count is the run itself.
const shared = (count) => Array.from({ length: count }, (_, index) => `token${index}`);
assert.equal(
  longestSharedRun(shared(lineageTokens - 1), [...shared(lineageTokens), "extra"]),
  lineageTokens - 1,
  "a shared run of one token short of the threshold is measured exactly",
);
assert.ok(
  !provesMove(shared(lineageTokens - 1), [...shared(lineageTokens), "extra"]),
  `${lineageTokens - 1} identical tokens are one short of lineage`,
);
assert.ok(
  provesMove(shared(lineageTokens), [...shared(lineageTokens), "extra"]),
  `${lineageTokens} identical tokens are lineage`,
);

assert.equal(longestSharedRun(["a", "b"], ["a", "b"]), 0, "a run shorter than one anchor is not a run");
assert.equal(longestSharedRun([], []), 0, "no tokens means no lineage");
assert.equal(
  longestSharedRun(legacyTokens, legacyTokens),
  legacyTokens.length,
  "a function compared with itself is a full-length run and stops the scan",
);

assert.equal(
  censusKey({ file: "lib/a.mjs", path: ["writeBundle"], ordinal: 1 }),
  "lib/a.mjs:writeBundle",
  "a label that does not repeat keeps no ordinal",
);
assert.equal(
  censusKey({ file: "tests/server-cards.test.mjs", path: ["callback"], ordinal: 4 }),
  "tests/server-cards.test.mjs:callback#4",
  "a repeated label keeps its ordinal, which is what the debt ledger is keyed on",
);
assert.equal(
  censusKey({ file: "lib/a.mjs", path: ["outer", "inner"], ordinal: 1 }),
  "lib/a.mjs:outer/inner",
  "a nested function is keyed on its whole path",
);

assert.equal(pathAffinity(["outer", "inner"], ["outer", "inner"]), 1, "an identical path is full affinity");
assert.equal(pathAffinity(["outer"], ["other"]), 0, "a different first segment shares nothing");
assert.equal(
  pathAffinity(["outer", "inner"], ["outer"]),
  0.5,
  "affinity is normalized by the longer path",
);
assert.equal(
  pathAffinity(["a", "b", "c"], ["a", "x", "c"]),
  1 / 3,
  "affinity stops at the first divergence",
);
assert.equal(pathAffinity([], ["a"]), 0, "an empty path has no affinity");

console.log(`budget lineage ok: ${lineageTokens} tokens prove a move, a shared vocabulary does not`);
