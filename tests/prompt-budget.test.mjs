import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allClauseTexts, clauseTexts, renderSpawnPaths } from "./helpers/prompt-paths.mjs";
import {
  CHARS_PER_TOKEN,
  estimateTokens,
  normalizeClause,
  promptBudget,
  repeatedSentences,
  sharedAcrossPaths,
  composedBudget,
} from "../lib/prompt-budget.mjs";
import {
  CLAUSE_CHAR_CEILINGS,
  clauseBudgetFindings,
  clausesWithoutCeiling,
} from "../lib/prompt-clause-budgets.mjs";
import { BUILDER_CLAUSES, CLAUSE_ORDER } from "../server/runtime/workflow-shared.ts";
import { DONE_PROTOCOL_CORE } from "../server/runtime/plugin-protocols.ts";

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
 * const, and re-measured 2026-10-23 when the track prompts were reordered and
 * the tracks stopped carrying the build completion payload. A path that
 * exceeds its ceiling fails here with the delta named; the ceilings ratchet
 * down with the prompts and are never raised to let a change fit.
 *
 * The two track numbers are the ones that moved most: research 11,414 -> 9,690
 * and explore 8,603 -> 6,702, because 2,300 characters of build-only
 * completion protocol left them and no clause was lost in exchange. */
const CHAR_CEILINGS = {
  spawn: 13_300,
  restart: 12_980,
  reseed: 12_440,
  research: 9_710,
  explore: 6_720,
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
const composed = composedBudget(paths, clauseTexts());
assert.ok(
  shared.duplicationRatio <= 0.5,
  `shared boilerplate across the five spawn paths stays under half of all rendered text (measured ${(shared.duplicationRatio * 100).toFixed(1)}%)`,
);
assert.ok(
  shared.duplicatedChars > 0,
  "the duplication measurement found real duplication — a zero here means the detector stopped matching, not that the prompts converged",
);

// --- Per-clause ceilings: name the clause, not the victim path. -------------
// The path ceilings above catch a prompt growing; they cannot say WHICH clause
// grew, and the smallest path always fails first. Measured when this table was
// introduced: 11,700 of the reseed prompt's 12,490 chars were verbatim clause
// text, so a sentence added to `doneProtocol` reported "reseed exceeds by 1".
// True, and useless. These ceilings name the cause.
{
  // BOTH bags. The table is keyed on clause names from the build bag and the
  // track bag, and a clause's size does not depend on which path renders it —
  // so the findings are computed over the union, and an entry that resolves in
  // neither bag is still reported as unbudgeted.
  const texts = { ...allClauseTexts(), ...BUILDER_CLAUSES };
  const { overBudget, unbudgeted, loose } = clauseBudgetFindings(texts);

  assert.deepEqual(overBudget, [], `no shared clause exceeds its own char ceiling. Over: ${overBudget.join("; ")}`);

  // Every budgeted clause must resolve to a real clause text, or the ceiling
  // guards nothing. A rename that orphans an entry is a silent pass.
  assert.deepEqual(
    unbudgeted,
    [],
    `every clause ceiling must resolve to a real clause. Unresolved: ${unbudgeted.join(", ")}`,
  );

  // The other direction: a clause that renders in a prompt but has NO ceiling
  // escapes the budget entirely, which is how `doneProtocol` reached 2,479
  // chars without anyone deciding it should.
  const rendered = Object.keys(texts);
  const ceilingless = clausesWithoutCeiling(rendered);
  assert.deepEqual(
    ceilingless,
    [],
    `every clause in the bag declares a char ceiling. Missing: ${ceilingless.join(", ")}`,
  );

  // Ratchet: a ceiling is not headroom. If a clause shrank, the ceiling must be
  // lowered in the same commit — otherwise the slack silently becomes a budget
  // for the next author. This asserts the table is not looser than reality.
  assert.deepEqual(loose, [], `clause ceilings track reality, not headroom. Loose: ${loose.join("; ")}`);
}

// --- The budgets module leads with the rule, not a measured share. ---------
// It used to quote "11,700 of the reseed prompt's 12,490 chars (93.7%)"; by the
// time this pin was written the same measurement was 11,902 of 12,490 (95.3%).
// The per-clause ceilings ARE gates; an aggregate restated in prose is not, so it
// drifts with every clause edit and nothing fails. The run prints the path sizes —
// point the reader there instead of pasting a number.
const budgetsSource = readFileSync(join(root, "lib/prompt-clause-budgets.mjs"), "utf8");
assert.doesNotMatch(
  budgetsSource,
  /\b\d[\d,]* of the .*prompt's \d[\d,]* chars\b/,
  "prompt-clause-budgets must not restate an aggregate size; the run prints the measured sizes",
);

// --- The render order and the size contract are the same list. -------------
// The order the builder renders in and the keys the ceilings are written
// against have to be one set: a clause rendered but unbudgeted is invisible,
// and a ceiling for a clause that is never rendered guards nothing.
{
  const texts = { ...clauseTexts(), ...BUILDER_CLAUSES };
  const rendered = CLAUSE_ORDER.map((clause) => clause);
  assert.deepEqual(
    rendered.filter((clause) => !(clause in texts)),
    [],
    "the render order names a clause the bag does not carry",
  );
  const unbudgeted = rendered.filter((clause) => !(clause in CLAUSE_CHAR_CEILINGS));
  assert.deepEqual(
    unbudgeted,
    [],
    `every rendered clause declares a char ceiling. Missing: ${unbudgeted.join(", ")}`,
  );
  const bagNotRendered = Object.keys(texts).filter((clause) => !rendered.includes(clause));
  assert.deepEqual(
    bagNotRendered,
    [],
    `the bag carries a clause the builder never renders: ${bagNotRendered.join(", ")}`,
  );
}

// --- The completion rule is split by track, and the build half is intact. ---
// The split exists so a research or explore worker stops reading 2.3 KB about
// an `audit` stage it can never reach. The risk it creates is the opposite one:
// a build worker losing a rule because the constant it read was cut in the
// wrong place. So the assembly is asserted, not eyeballed — the build clause
// must still be exactly the core rule plus the build payload, and the two halves
// must not overlap.
{
  const build = allClauseTexts().doneProtocol;
  const track = allClauseTexts().doneProtocolTrack;
  assert.ok(build.startsWith(DONE_PROTOCOL_CORE), "the build clause opens with the core rule");
  assert.ok(track.startsWith(DONE_PROTOCOL_CORE), "the track clause opens with the same core rule");
  assert.ok(
    build.includes("Build cards complete only at the `audit` stage"),
    "the build clause keeps the completion stage a build worker is held to",
  );
  assert.ok(
    !build.includes("research/explore cards complete only after"),
    "the build clause no longer restates a rule that belongs to the tracks",
  );
  assert.ok(
    track.includes("Research/explore cards complete only after `bb stelow verify` passes"),
    "the track clause carries the completion rule a track worker is held to",
  );
  assert.ok(
    !track.includes("`audit` stage"),
    "the track clause does not send a research or explore worker to a stage it does not have",
  );
  // The size split, so a future edit cannot quietly move build prose into the
  // track half (which would be a build worker losing a rule, not a track one
  // gaining it).
  assert.ok(
    track.length < DONE_PROTOCOL_CORE.length + 100,
    `the track half states the core rule and one sentence, nothing else (got ${track.length} chars)`,
  );
}

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

// Both figures, labelled. The naive one counts shared clauses rendering into the paths
// that owe them, so it is context; the composed one is the target. Printing only the
// naive number — as this line used to — puts the wrong metric in front of whoever reads
// a test run, which is how a metric gets optimized for the wrong reason.
console.log(
  `prompt budget ok: ${Object.entries(measured)
    .map(([name, entry]) => `${name}=${entry.chars}c/~${entry.estimatedTokens}t`)
    .join(" ")} · authored duplication ${(composed.composedDuplicationRatio * 100).toFixed(1)}%`
    + ` (${composed.composedDuplicatedChars}c of ${composed.composedChars})`
    + ` · naive ${(shared.duplicationRatio * 100).toFixed(1)}% is mostly the clause bag`,
);
