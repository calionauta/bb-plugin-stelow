import assert from "node:assert/strict";
import { clauseTexts, renderSpawnPaths } from "./helpers/prompt-paths.mjs";
import { composedBudget, composedText, normalizeClause, sharedAcrossPaths } from "../lib/prompt-budget.mjs";

/**
 * The prompt-size metric that cannot be cheated by deleting a protocol.
 *
 * `duplicatedChars` was the obvious target and it was wrong, measured: it reported
 * 22,805 characters of duplication, and block by block 21,883 of them — 39 of 44
 * blocks — came from the shared clause consts the bag exists to render into every
 * path that owes them. The metric was counting the bag WORKING. An optimization
 * loop handed that number earns it by removing protocols from the paths that need
 * them, and every guard this session wrote would fight it.
 *
 * `composedDuplicationChars` subtracts the clauses first, so what it counts is prose
 * a template authored itself. The real duplication is 2,705 characters — 15.7% of
 * the 17,180 characters the templates write, and 4.9% of all rendered text. Same
 * checkout, same prompts, a target 8x smaller and one that cannot be lowered by
 * deleting a rule.
 */

const paths = renderSpawnPaths();
const clauses = clauseTexts();
const composed = composedBudget(paths, clauses);
const raw = sharedAcrossPaths(paths);

// --- 1. The two metrics disagree, and by roughly the size of the bag. --------
// Stated as a relationship rather than two literals: the point is that the naive
// metric inflates, not that either number is a particular value on this commit.
assert.ok(
  composed.composedDuplicatedChars < raw.duplicatedChars,
  "subtracting the clauses lowers the figure — the naive metric counted the bag as duplication "
    + `(raw ${raw.duplicatedChars}, composed ${composed.composedDuplicatedChars})`,
);
assert.ok(
  composed.composedDuplicatedChars > 0,
  "shared clause rendering is not the ONLY shared text: some prose is genuinely authored twice, which is what this metric is for",
);

// --- 2. A clause can never be a reason this number moves. -------------------
// The property that makes it safe as an optimization target, asserted directly:
// every clause's own prose is gone from the composed text of every path.
const composedTexts = Object.fromEntries(Object.entries(paths).map(([name, rendered]) => [name, composedText(rendered, clauses)]));
for (const [name, text] of Object.entries(composedTexts)) {
  for (const [clause, body] of Object.entries(clauses)) {
    const probe = normalizeClause(body);
    assert.ok(
      !text.includes(probe),
      `${name}'s composed text does not contain ${clause} — a clause present here would let deleting the clause lower the metric`,
    );
  }
}

// --- 3. It still measures what it claims to. --------------------------------
// The negative control in the direction that matters: moving a duplicated piece of
// AUTHORED prose into a shared const must lower the metric, and leaving it alone
// must not. Built from synthetic prompts so the assertion is about the function,
// not about this commit's prose — and the authored paragraph is comfortably over the
// paragraph-sized threshold, because a fixture below it would prove nothing.
const CLAUSES = { shared: "This sentence belongs to a shared clause and is subtracted before anything is counted at all." };
const DUPLICATED_PROSE =
  "The templates both wrote this identical paragraph by hand, at length, with enough words in it to be a real paragraph "
  + "rather than a fragment, and it is long enough that the detector treats it as a block worth reporting to whoever "
  + "is doing the work.";
const withDup = {
  a: `${CLAUSES.shared} ${DUPLICATED_PROSE}`,
  b: `${CLAUSES.shared} ${DUPLICATED_PROSE}`,
};
const deduped = {
  a: `${CLAUSES.shared} One template now says this, and says it differently from the other one by a wide margin.`,
  b: `${CLAUSES.shared} The other template says something else entirely, in its own words, with no overlap at all here.`,
};
// Asserted first, so a fixture that fails to trigger the detector reports that
// rather than being read as "the metric is broken".
assert.ok(
  sharedAcrossPaths(withDup).duplicatedChars > 0,
  "the synthetic duplicate is a real block for the shared-text detector, so the next assertion has something to measure",
);
assert.ok(
  composedBudget(withDup, CLAUSES).composedDuplicatedChars > 0,
  "an authored paragraph written twice is counted",
);
assert.equal(
  composedBudget(deduped, CLAUSES).composedDuplicatedChars,
  0,
  "and moving it out of the templates lowers the metric — which is the work the metric is supposed to reward",
);
assert.equal(
  composedBudget(withDup, {}).composedDuplicatedChars,
  composedBudget(withDup, CLAUSES).composedDuplicatedChars,
  "a clause nobody passes in cannot be subtracted, so an empty clause set is the un-subtracted reading "
    + "— the function does not silently know about clauses it was not given",
);

// --- 4. Subtracting every clause does not empty a prompt. -------------------
// A subtraction that removed everything would make the metric zero for the wrong
// reason. The templates author real prose and it must survive.
for (const [name, text] of Object.entries(composedTexts)) {
  assert.ok(text.trim().length > 200, `${name} still has authored prose after the clauses are removed (got ${text.trim().length} chars)`);
}
assert.ok(composed.composedChars > 10_000, `the templates author a substantial amount of their own prose (got ${composed.composedChars})`);

// --- 5. The work list is ordered by what it is worth. -----------------------
// A caller fixes the top of the list first, so it must be sorted by waste, not by
// block size: a 400-character block in five paths is worth more than a
// 500-character block in two.
for (let i = 1; i < composed.blocks.length; i += 1) {
  const prev = composed.blocks[i - 1].chars * (composed.blocks[i - 1].paths.length - 1);
  const here = composed.blocks[i].chars * (composed.blocks[i].paths.length - 1);
  assert.ok(prev >= here, `work list is sorted by chars x extra copies: ${prev} before ${here}`);
}

// --- 6. Every block is a real paragraph from a real prompt. ------------------
for (const block of composed.blocks) {
  assert.ok(block.paths.length > 1, "a shared block is in more than one path by definition");
  assert.ok(block.chars >= 120, `blocks are paragraph-sized, not fragments (got ${block.chars})`);
  // Compared through the same normalisation the detector uses: the composed text has
  // had clauses cut out of it and runs of whitespace collapsed, so a byte-exact
  // search against the original prompt would fail for a block that is genuinely there.
  const needle = normalizeClause(block.paragraph);
  assert.ok(
    Object.values(composedTexts).some((text) => normalizeClause(text).includes(needle)),
    "and it came from the composed text, so the work list can be acted on without guessing",
  );
}

console.log(
  `prompt composition ok: ${composed.composedDuplicatedChars} chars authored twice `
    + `(${(composed.composedDuplicationRatio * 100).toFixed(1)}% of ${composed.composedChars} authored) — `
    + `against ${raw.duplicatedChars} the naive metric reports, because `
    + `${raw.duplicatedChars - composed.composedDuplicatedChars} of those are the shared clause bag doing its job`,
);
