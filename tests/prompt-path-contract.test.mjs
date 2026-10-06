import assert from "node:assert/strict";
import { PATH_CONTRACTS, clauseTexts, renderSpawnPaths } from "./helpers/prompt-paths.mjs";
import { ASK_CONTRACT_RULES, USER_INPUT_CONTRACT } from "../server/runtime/plugin-protocols.ts";
import {
  clausesPresent,
  contradictedRules,
  missingClauses,
  normalizeClause,
  pinnedSentenceDiff,
  sharedAcrossPaths,
} from "../lib/prompt-budget.mjs";

/**
 * Every spawn path carries every clause it owes, measured on the rendered
 * prompt.
 *
 * The regression this exists to catch is specific and already happened. The ask
 * contract — "you MUST call the structured form, NEVER just write text like
 * waiting for your choice", plus the timeout rule that tells a worker to stop
 * rather than narrate — was a literal block pasted into the five builders. Two
 * of the five lost the waiting-text guard and the restart path, which takes
 * over at every band boundary, lost the timeout rule. The suite stayed green
 * throughout: `prompt-contracts.test.mjs` scans *source text* for token names,
 * so a token that renders empty and a block that a path skips entirely both
 * pass. A card whose worker writes "waiting for your choice" into chat and ends
 * its turn sits in its column looking busy while nothing is pending.
 *
 * Every assertion here reads the rendered string. Nothing reads a file.
 */

const paths = renderSpawnPaths();
const clauses = clauseTexts();

// The matrix is driven by the declaration, not by a list written here: a sixth
// spawn path added to the helper is covered the moment it is declared, which is
// the property the previous test lacked (its `sites` map had one entry).
const pathNames = Object.keys(PATH_CONTRACTS);
assert.deepEqual(
  Object.keys(paths).sort(),
  [...pathNames].sort(),
  "every declared path actually renders — a path renamed in the helper and not here would otherwise silently stop being checked",
);

// --- 1. Every path renders a real prompt, not an empty template. ------------
// The failure mode `build-prompt-render` was written for, asserted across the
// whole matrix: a template whose tokens all interpolate to "" renders a prompt
// with no request body, and the worker opens a question about work it never
// received.
for (const name of pathNames) {
  const rendered = paths[name];
  assert.ok(rendered.length > 2000, `${name} renders a substantial prompt (got ${rendered.length} chars)`);
  assert.ok(
    rendered.includes("Add a read-only Scope Map view to an existing Build card."),
    `${name} carries the request body`,
  );
}

// --- 2. Every owed clause reaches its path, by prose. -----------------------
// Presence is decided by the clause's own first sentence. A token scan cannot
// distinguish `%USER_INPUT_CONTRACT%` that rendered the clause from the same
// token that rendered "" — which is exactly the drift that shipped.
const missingByPath = {};
for (const [name, owed] of Object.entries(PATH_CONTRACTS)) {
  const owedClauses = Object.fromEntries(owed.map((clause) => [clause, clauses[clause]]));
  const missing = missingClauses(paths[name], owedClauses);
  if (missing.length > 0) missingByPath[name] = missing;
}
assert.deepEqual(
  missingByPath,
  {},
  `every spawn path must render every clause it owes. Missing: ${JSON.stringify(missingByPath)}`,
);

// --- 3. The two clauses that drifted are present on every path that can ask. -
// Stated separately from the matrix because these are the two whose loss has a
// named symptom, and a failure should read as that symptom rather than as an
// index into a list.
for (const name of pathNames) {
  const haystack = normalizeClause(paths[name]);
  assert.ok(
    haystack.includes("NEVER just write text like"),
    `${name} forbids writing waiting text — a worker that narrates a wait leaves the card looking busy with nothing pending`,
  );
  assert.ok(
    haystack.includes("No response after Ns"),
    `${name} carries the timeout rule — without it a timed-out ask is read as permission to carry on`,
  );
}

// --- 3b. Presence is not meaning: the contract's rules must not be inverted. -
// This half exists because a substring match is not a semantics match, and the
// gap was real and twice over.
//
// First, verified by mutation while writing this file: rewording the timeout rule
// from "STOP and wait: do NOT proceed with the workflow" to "PROCEED with the
// workflow using your best judgement" left every phrase assertion 3 greps for
// intact and inverted the rule.
//
// Then the first fix — a blacklist of two forbidden literals — was itself
// defeated by adversarial review, which rewrote the same rule to "CONTINUE the
// workflow with your best judgement — the older STOP and wait / do NOT proceed
// wording no longer applies": every required phrase present (the mutation *quotes*
// them while contradicting them), no blacklisted word, green on all five paths.
//
// So the rules are declared in the source beside the clause (`ASK_CONTRACT_RULES`)
// and each one names both the phrase that states it and the wording that negates
// it. The declaration lives next to the prose it describes, which is what keeps the
// two from drifting — the failure this whole file exists for.
const ASK_PATHS = pathNames.filter((name) => PATH_CONTRACTS[name].includes("userInputContract"));
assert.ok(ASK_PATHS.length > 0, "at least one path carries the ask contract");
for (const path of ASK_PATHS) {
  const reasons = contradictedRules(paths[path], ASK_CONTRACT_RULES);
  assert.deepEqual(
    reasons,
    [],
    `${path} states every ask-contract rule without contradicting it. Contradictions: ${reasons.join("; ")}`,
  );
}

// The rules themselves are guarded: a declaration that lost its teeth (empty
// lists, a rule with no required phrase) would make the loop above vacuous.
assert.ok(ASK_CONTRACT_RULES.length >= 7, `the ask contract declares its rules (got ${ASK_CONTRACT_RULES.length})`);
for (const rule of ASK_CONTRACT_RULES) {
  assert.ok(typeof rule.required === "string" && rule.required.length > 0, "every rule names the phrase that states it");
  assert.ok(
    (rule.contradictedBy?.length ?? 0) > 0 || (rule.negatingVerbs?.length ?? 0) > 0,
    `every rule names how it could be contradicted, or it can never fail: ${rule.required}`,
  );
}
const timeoutRule = ASK_CONTRACT_RULES.find((rule) => rule.required === "No response after Ns");
assert.ok(timeoutRule, "the timeout rule is declared");
assert.equal(timeoutRule.requiredAlso, "STOP and wait", "the timeout rule requires its own positive anchor");
assert.ok(
  timeoutRule.negatingVerbs.includes("continue") && timeoutRule.negatingVerbs.includes("proceed"),
  "the timeout rule knows both verb families the adversarial review used to defeat the blacklist",
);

// --- 3c. The contract's rules are pinned as EQUALITY, not as a vocabulary. ---
// This is the third design for this check and the first one that survives a
// determined rewrite. Four successive wordings defeated four successive blacklists:
// "PROCEED with your best judgement", then "CONTINUE ... the older STOP and wait
// wording no longer applies" (quoting the required phrases while negating them),
// then "STOP and wait, then continue", then — found mutation-in-flight during the
// adversarial review that produced this — "STOP and wait is advisory only: feel
// free to resume the workflow and finish the stage", which passed a list that
// already knew continue/proceed/carry on/move on/press on/use your judgement.
//
// The lesson is that any check enumerating forbidden wordings loses to the next
// wording. So the pin is an equality on the rule sentences themselves: the clause
// must state exactly these sentences, no more and no fewer. A novel inversion
// cannot pass an equality check, because it is by definition a different sentence.
//
// Rewrapping inside a sentence stays free (whitespace collapses), so the size work
// this session's loop exists for is not blocked. Changing what a rule SAYS means
// updating the pin — the moment a person reads the rule and confirms it still
// means what it meant, which is the review the original drift skipped.
// Seven sentences, not nine: the critical header, the ask synopsis, and the batch
// rule share one terminal ":" before the batching sentence, so the extractor sees
// them as one rule sentence. The pin records what the extractor actually sees,
// because an equality pin is only honest if it is copied from the text rather
// than composed by hand.
const PINNED_ASK_RULES = [
  'CRITICAL — User input contract: ANY time you need user input, you MUST call the structured form, '
    + 'NEVER just write text like "waiting for your choice": bb stelow ask --thread "$BB_THREAD_ID" '
    + '--question "<a single clear question>" --option "<label 1>" --option "<label 2>" '
    + '[--option "<label 3>" ...] [--multiple] Batch independent questions into ONE ask call by repeating '
    + "--question groups (each with its own --option labels) — the user answers them together instead of being pinged one by one.",
  "Ask dependent questions (where Q2 needs Q1's answer) one at a time.",
  "When the human must compare artifacts to decide (interface picks, plan reviews), attach each option's evidence: "
    + "--desc for trade-offs, --preview for the inline glance, --artifact for the workspace-relative file they can open.",
  "Before asking a question, first summarize what you read (files, plan, codebase) so the user can answer with context "
    + "— never dump a raw file list as the only content of a question.",
  "Each bb stelow ask call blocks until the user submits; the card stays in its column and signals it is waiting for an answer.",
  'If an ask returns "No response after Ns" (timeout), STOP and wait: do NOT proceed with the workflow.',
  "The question stays pending on the card and remains answerable; when the user answers it on the card, "
    + "the answer is delivered to you as a message and you continue from there.",
  "Never re-ask the same question — wait for the card answer.",
];

// Scope matters here and the first version got it wrong: an equality pin run over
// the WHOLE rendered prompt reports every other clause and all of the template as
// "extra", so it could never be green and would be deleted within a week. The pin
// belongs on the source of truth — the const — because that is where all four
// documented attacks actually landed. The rendered prompt is then checked for what
// a template-level injection would look like: a second copy of a pinned rule.
const clauseDiff = pinnedSentenceDiff(USER_INPUT_CONTRACT, PINNED_ASK_RULES);
assert.deepEqual(
  clauseDiff.missing,
  [],
  `the ask contract const states every pinned rule. Missing (a rule was rewritten or dropped): ${JSON.stringify(clauseDiff.missing)}`,
);
assert.deepEqual(
  clauseDiff.extra,
  [],
  `the ask contract const states no rule beyond the pinned ones. Extra: ${JSON.stringify(clauseDiff.extra)} `
    + "— an inverted restatement lands here, because it is a sentence nobody pinned",
);

const TIMEOUT_ANCHOR = "No response after Ns";
const TIMEOUT_RULE =
  'If an ask returns "No response after Ns" (timeout), STOP and wait: do NOT proceed with the workflow.';
for (const path of ASK_PATHS) {
  const rendered = normalizeClause(paths[path]);
  // Exactly one statement of the timeout rule. A template that appends its own
  // contradictory version — the appended-restatement attack, which the presence
  // checks above cannot see because the intact original is still there — makes
  // this two.
  const occurrences = rendered.split(TIMEOUT_ANCHOR).length - 1;
  assert.equal(
    occurrences,
    1,
    `${path} states the timeout rule exactly once (found ${occurrences}) — a second statement is how a restatement contradicts the first without removing it`,
  );
  assert.ok(
    rendered.includes(TIMEOUT_RULE),
    `${path} states the timeout rule verbatim — a paraphrase must update the pin, which is the moment somebody reads the rule`,
  );
}

assert.ok(
  !PINNED_ASK_RULES.some((sentence) => /advisory only|feel free to resume/i.test(sentence)),
  "no pinned rule is an advisory restatement of a hard rule",
);

// --- 4. No path carries a clause twice. -------------------------------------
// The block grew by accretion, and accretion duplicates rules: "never re-ask
// the same question" was stated once per paragraph it was appended to. A model
// reading a prompt pays for the second copy and learns nothing from it.
const duplicated = {};
for (const name of pathNames) {
  const counts = {};
  for (const [clause, text] of Object.entries(clauses)) {
    const probe = normalizeClause(text).slice(0, 80);
    const occurrences = normalizeClause(paths[name]).split(probe).length - 1;
    if (occurrences > 1) counts[clause] = occurrences;
  }
  if (Object.keys(counts).length > 0) duplicated[name] = counts;
}
assert.deepEqual(duplicated, {}, `no clause may be rendered twice on one path: ${JSON.stringify(duplicated)}`);

// --- 5. The ask contract exists once in the source tree. --------------------
// The structural half of the same bug. Interpolating a shared const is the fix;
// pasting the prose again is the regression, and it is invisible in a rendered
// prompt (which is why assertion 2 cannot catch it alone).
const contractProbe = "CRITICAL — User input contract:";
const duplicateOwners = pathNames.filter((name) => {
  const rendered = paths[name];
  return rendered.split(contractProbe).length - 1 !== 1;
});
assert.deepEqual(duplicateOwners, [], "every path renders the ask contract exactly once");

// --- 6. The measurements the budget test consumes, reported here. -----------
// Shared boilerplate across paths is the fleet-level reading of "this prompt is
// maintained in five places". The numbers are asserted in `prompt-budget`; here
// the shape is checked so that test cannot silently measure nothing.
const shared = sharedAcrossPaths(paths);
assert.ok(shared.totalChars > 0, "the shared-text measurement saw the rendered prompts");
assert.ok(
  shared.shared.length > 0,
  "the build paths share boilerplate — if this ever reads zero, the shared-text detector stopped matching rather than the duplication disappearing",
);
assert.ok(
  shared.duplicationRatio > 0 && shared.duplicationRatio < 1,
  `duplication ratio is a fraction of total text (got ${shared.duplicationRatio})`,
);

// Present as a lookup for the budget test rather than recomputed there.
assert.deepEqual(
  Object.keys(clausesPresent(paths.spawn, { contract: clauses.userInputContract })),
  ["contract"],
  "a single-clause presence check returns exactly the clause asked about",
);

console.log(
  `prompt path contract ok: ${pathNames.length} paths, ${Object.keys(clauses).length} clauses, ` +
    `${shared.shared.length} shared paragraphs (${Math.round(shared.duplicationRatio * 100)}% duplication)`,
);
