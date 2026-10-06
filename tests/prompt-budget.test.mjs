import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSpawnPaths } from "./helpers/prompt-paths.mjs";
import {
  CHARS_PER_TOKEN,
  contradictsClause,
  estimateTokens,
  normalizeClause,
  promptBudget,
  repeatedSentences,
  sharedAcrossPaths,
} from "../lib/prompt-budget.mjs";

/**
 * The prompt budget, pinned.
 *
 * What a worker costs before it does anything is the sum of its prompt and the
 * context it drags along, and nothing in the suite was measuring the first half.
 * Five builders had grown to 5.5KB–15.6KB with no assertion on any of them: a
 * refactor could add forty percent to every spawn and the suite would stay
 * green, which makes prompt growth a thing discovered on the bill rather than
 * in review.
 *
 * The budgets below are set from the measured values on the commit that
 * introduced this test, with headroom for legitimate growth and no more. They
 * are ceilings, not targets: the number that matters is the byte count, and a
 * change that adds prose has to decide that the prose is worth the budget.
 *
 * Token figures are estimates (CHARS_PER_TOKEN) and are labelled as such
 * everywhere they appear. Provider-reported usage is `lib/token-usage.mjs`'s
 * job and it is never estimated there.
 */

const paths = renderSpawnPaths();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Measured on 2026-10-05, after the ask contract was de-duplicated into one
 * const. A path that exceeds its ceiling fails here with the delta named. */
const CHAR_CEILINGS = {
  spawn: 13_500,
  restart: 13_500,
  reseed: 12_500,
  research: 12_000,
  explore: 9_000,
};

/** The measured cost of each path, so a regression reads as a number rather
 * than as "the assertion failed". */
const measured = Object.fromEntries(
  Object.entries(paths).map(([name, rendered]) => [name, promptBudget(rendered, { path: name })]),
);

for (const [name, ceiling] of Object.entries(CHAR_CEILINGS)) {
  const { chars, estimatedTokens } = measured[name];
  assert.ok(
    chars <= ceiling,
    `${name} prompt is within budget: ${chars} chars (~${estimatedTokens} tokens est.) exceeds the ${ceiling}-char ceiling by ${chars - ceiling}`,
  );
  // The floor half of the same guard: a prompt that got suspiciously short has
  // probably lost a clause, and the clause test cannot see a path that dropped
  // a clause nobody declared it owes.
  assert.ok(
    chars > ceiling / 3,
    `${name} prompt is not suspiciously short: ${chars} chars is under a third of its ${ceiling}-char ceiling, which usually means a clause stopped rendering`,
  );
}

// --- The estimate is an estimate, and says so. ------------------------------
assert.equal(CHARS_PER_TOKEN, 4, "the chars-per-token rule of thumb is stated once");
assert.equal(estimateTokens("aaaa"), 1, "four characters is one estimated token");
assert.equal(estimateTokens(""), 0, "an empty prompt costs nothing");

// --- Repeated sentences are counted, because accretion duplicates rules. ----
// A sentence repeated inside one rendered prompt is a rule the model reads
// twice and the operator pays for twice. Short fragments ("--multiple`") repeat
// legitimately inside a command example, so only rule-length sentences count —
// and the threshold is asserted here so it cannot be quietly raised to make a
// failing measurement pass.
const repeated = repeatedSentences("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau. ".repeat(2));
assert.equal(repeated.length, 1, "a long sentence repeated verbatim is counted once, with its count");
assert.equal(repeated[0].count, 2, "the count is the number of occurrences");
assert.deepEqual(repeatedSentences("Short. Also short. Tiny."), [], "fragments below the rule-length floor are not counted as repeated rules");

const repeatedByPath = Object.fromEntries(
  Object.entries(paths).map(([name, rendered]) => [name, repeatedSentences(rendered).map((entry) => entry.sentence.slice(0, 60))]),
);
// This is a measurement, not a ceiling: the five builders legitimately restate a
// few rules (the ask form, the advance rule). What must not happen is that the
// operator stops being able to see it.
assert.ok(
  Object.values(repeatedByPath).every((list) => list.length <= 8),
  `no path repeats more than eight rule-length sentences: ${JSON.stringify(repeatedByPath, null, 2)}`,
);

// --- Shared boilerplate across paths is the fleet's duplication ratio. ------
// De-duplicating the ask contract moved this ratio down; the assertion pins the
// ceiling so it cannot drift back up unnoticed. The number is deliberately a
// ceiling on a real measurement rather than an exact equality: a new path that
// legitimately shares text should not fail the suite, but a new path that
// pastes three paragraphs should.
const shared = sharedAcrossPaths(paths);
assert.ok(
  shared.duplicationRatio <= 0.5,
  `shared boilerplate across the five spawn paths stays under half of all rendered text (measured ${(shared.duplicationRatio * 100).toFixed(1)}%)`,
);
assert.ok(
  shared.duplicatedChars > 0,
  "the duplication measurement found real duplication — a zero here means the detector stopped matching, not that the prompts converged",
);

// --- The inversion detector is itself guarded. ------------------------------
// A detector with no negative control is a detector that can silently stop
// detecting — which is exactly the failure it exists to catch, one level up. The
// interesting case is the third one: the correct phrasing of a prohibition
// contains the prohibited phrase, so a naive substring check would flag correct
// text and the whole assertion would be turned off within a week.
const PROHIBITED = "proceed with the workflow";
assert.equal(
  contradictsClause("STOP and wait: do NOT proceed with the workflow.", PROHIBITED),
  false,
  "a negated rule reads as stated, even though it contains the prohibited phrase",
);
assert.equal(
  contradictsClause("STOP and wait, then proceed with the workflow.", PROHIBITED),
  true,
  "an un-negated occurrence is a contradiction",
);
assert.equal(contradictsClause("never proceed with the workflow.", PROHIBITED), false, "'never' negates the same phrase");
assert.equal(contradictsClause("nothing about it here.", PROHIBITED), false, "an absent phrase is not a contradiction");
assert.equal(
  contradictsClause("do NOT proceed with the workflow, and the gate never parks — so proceed with the workflow.", PROHIBITED),
  true,
  "one negated occurrence does not excuse a later un-negated one",
);
assert.equal(contradictsClause("", PROHIBITED), false, "empty text contradicts nothing");
assert.equal(contradictsClause("anything", ""), false, "an empty probe matches nothing, so it can never fire on every prompt");

// --- The clauses are single-owner in the source tree. -----------------------
// The rendered-prompt assertions live in `prompt-path-contract`; this is the
// structural twin, and it is here because the two failures are different: a
// prompt can render correctly while the source keeps five drifting copies.
const protocols = readFileSync(join(root, "server/runtime/plugin-protocols.ts"), "utf8");
assert.equal(
  protocols.split("export const USER_INPUT_CONTRACT").length - 1,
  1,
  "the ask contract is defined once",
);
assert.equal(
  protocols.split("export const NEVER_SEED").length - 1,
  1,
  "the seed ban is defined once",
);
assert.ok(
  normalizeClause(protocols).includes("NEVER just write text like"),
  "the shared const carries the waiting-text guard, so no path can render a weaker version of it",
);

// A builder that pastes the block back is the regression, and it is invisible in
// the rendered output — the prompt still reads correctly, it is just
// maintained in two places again.
const builders = [
  "server/cards-create-prompt.ts",
  "server/runtime/worker-restart-prompt.ts",
  "server/runtime/card-reseed-prompt.ts",
  "server/runtime/track-prompts.ts",
];
const pasting = builders.filter((file) =>
  readFileSync(join(root, file), "utf8").includes("CRITICAL — User input contract:"),
);
assert.deepEqual(pasting, [], `no builder may paste the ask contract; it interpolates the const. Pasting: ${pasting.join(", ")}`);

console.log(
  `prompt budget ok: ${Object.entries(measured)
    .map(([name, entry]) => `${name}=${entry.chars}c/~${entry.estimatedTokens}t`)
    .join(" ")} · duplication ${(shared.duplicationRatio * 100).toFixed(1)}%`,
);
