/**
 * What a worker prompt costs, per clause and per spawn path.
 *
 * The suite could already prove a clause was *defined once* and *referenced* by
 * every spawn site (`prompt-contracts.test.mjs`). It could not prove the clause
 * was *present in the rendered prompt* on each path — the matrix there lists one
 * site, so a path that omits a clause keeps the suite green. That is not a
 * hypothetical: reading the five builders side by side, the ask contract is
 * pasted literally five times and has already drifted, with two of the five
 * paths missing the "never write waiting text" guard and the restart path (the
 * one that runs at every band boundary) missing the timeout clause.
 *
 * This module turns a rendered prompt into the facts a test can assert:
 *
 *   - how many characters it costs, and how that splits across the clauses
 *     that came from shared consts versus the template's own prose;
 *   - which canonical clauses reached it, by looking for the clause's own
 *     prose rather than its token name — a template can reference `${X}`
 *     while rendering `""`;
 *   - how much text is boilerplate repeated verbatim across paths.
 *
 * Pure and I/O-free by construction: the caller passes the rendered strings, so
 * a unit test needs no spawn, no database, and no host.
 */

/** A rough token price for a prompt, so a budget can be spoken about in the
 * unit the bill is in without pretending to be a tokenizer. Four characters per
 * token is the rule of thumb for English prose; every number derived from it is
 * labelled `estimated` so nobody reads it as provider-reported usage (which is
 * what `lib/token-usage.mjs` owns). */
export const CHARS_PER_TOKEN = 4;

/** Deterministic, allocation-free normalisation for clause matching and
 * duplicate detection: line-continuation backslashes are an artefact of the
 * template literal, not prompt content, and whitespace runs collapse so a
 * re-wrapped clause is the same clause. */
export function normalizeClause(text) {
  return String(text ?? "")
    .replace(/\\\n/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Estimated tokens for a rendered prompt. `estimated` is in the name on
 * purpose: a test that pins this is pinning a budget, not a measurement. */
export function estimateTokens(text) {
  const chars = typeof text === "string" ? text.length : 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Character cost per shared clause: the clause's own length times the number
 * of paths that render it. This is the number that answers "where did the
 * prompt budget go", and the one a de-duplication earns back. */
export function clauseCost(clause) {
  const length = normalizeClause(clause).length;
  return { length, tokens: Math.ceil(length / CHARS_PER_TOKEN) };
}

/**
 * Which canonical clauses reached a rendered prompt.
 *
 * Presence is decided by the clause's own prose, not by its token name: the
 * failure this exists to catch is a template that interpolates a token which
 * renders empty, and a token scan would call that present.
 *
 * `overrides.probe` lets a caller anchor a clause on a distinctive sentence
 * when the clause itself is long and a substring of it would be ambiguous; the
 * default probe is the clause's first sentence, which is the part a reader
 * identifies the clause by.
 */
export function clausesPresent(rendered, clauses) {
  const haystack = normalizeClause(rendered);
  const result = {};
  for (const [name, clause] of Object.entries(clauses)) {
    const probe = clause.probe ?? firstSentence(clause.text ?? clause);
    result[name] = probe.length > 0 && haystack.includes(normalizeClause(probe));
  }
  return result;
}

/** Every clause that did NOT reach the prompt, in declaration order. An empty
 * array is the passing case, and the test reports the names so a failure says
 * which spawn path lost which guard. */
export function missingClauses(rendered, clauses) {
  const present = clausesPresent(rendered, clauses);
  return Object.keys(clauses).filter((name) => !present[name]);
}

/** Whether a rendered prompt states the CONTRADICTION of a rule.
 *
 * A forbidden substring is not enough to detect a rule turned upside down, and
 * the reason is the same one that made presence-by-substring insufficient: the
 * correct phrasing of a prohibition contains the prohibited phrase. "do NOT
 * proceed with the workflow" contains "proceed with the workflow". A naive
 * check therefore fires on the correct text and misses nothing but confuses
 * everything.
 *
 * So an occurrence counts as a contradiction only when it is NOT negated — no
 * `not`/`never`/`no` immediately before it. Every occurrence negated means the
 * rule is stated; any un-negated occurrence means it is inverted. That is the
 * distinction a reader makes, made explicit.
 *
 * `window` is deliberately small: a negation anywhere in the sentence is not the
 * same as a negation of this phrase, and widening it would let "the gate never
 * parks, so proceed with the workflow" read as compliant.
 */
export function contradictsClause(rendered, phrase, { window = 10, caseInsensitive = false } = {}) {
  let haystack = normalizeClause(rendered);
  let needle = normalizeClause(phrase);
  if (!needle) return false;
  // Case handling is opt-in, and it is not cosmetic: adversarial review defeated
  // a same-case-only version by writing "CONTINUE the workflow with your best
  // judgement — the older STOP and wait / do NOT proceed wording no longer
  // applies". The uppercase verb is the negation and the quoted phrases are the
  // camouflage; a check that cannot see the first reports a contradiction-free
  // clause. Sentence-initial capitalisation is the common case in prompt prose,
  // so a verb list is matched insensitively.
  if (caseInsensitive) {
    haystack = haystack.toLowerCase();
    needle = needle.toLowerCase();
  }
  const negation = /(?:^|\s)(?:not|never|no)$/i;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = haystack.slice(Math.max(0, at - window), at).trimEnd();
    if (!negation.test(before)) return true;
    from = at + needle.length;
  }
}

/** The rules a canonical clause states, checked against a rendered prompt.
 *
 * This is the fix for the hole the first version had, found by adversarial review
 * rather than by the tests: the inversion check was a fixed vocabulary of wrong
 * words (`"PROCEED with the workflow"`), and a mutation that rewrote the timeout
 * rule to "CONTINUE the workflow with your best judgement — the older STOP and
 * wait / do NOT proceed wording no longer applies" kept every required phrase,
 * avoided the blacklist, and stayed green on all five paths. A list of known-bad
 * words is not a check; a rule that names its own contradiction is.
 *
 * Two kinds of rule, because two kinds of inversion exist:
 *
 *  - a phrase swap (`contradictedBy`): the negation has its own fixed wording.
 *  - a verb swap (`negatingVerbs`): "STOP and wait" replaced by any of continue /
 *    proceed / carry on / move on / use your judgement. Enumerating these in a
 *    blacklist is the trap that failed; here the rule requires its own positive
 *    anchor (`requiredAlso`) AND the absence of a leading negating verb *in the
 *    sentence that states the rule*, which is what a reader checks.
 *
 * Returns the list of reasons the clause is contradicted; empty means the clause
 * states what it is supposed to state.
 */
export function contradictedRules(rendered, rules) {
  const haystack = normalizeClause(rendered);
  const reasons = [];
  for (const rule of rules) {
    if (!haystack.includes(normalizeClause(rule.required))) {
      // Absence is the coverage test's job; reporting it here would name the same
      // defect twice under a less accurate label.
      continue;
    }
    if (rule.requiredAlso && !haystack.includes(normalizeClause(rule.requiredAlso))) {
      reasons.push(`${rule.required} is stated without "${rule.requiredAlso}"`);
    }
    for (const phrase of rule.contradictedBy ?? []) {
      if (contradictsClause(haystack, phrase)) reasons.push(`contains "${phrase}"`);
    }
    if (rule.negatingVerbs) {
      // The sentence that states the rule, isolated: a negating verb elsewhere in
      // the prompt ("continue from the current stage") is legitimate and must not
      // be read as contradicting the timeout rule.
      const sentences = haystack.split(/(?<=\.)\s+/).filter((sentence) => sentence.includes(normalizeClause(rule.required)));
      if (sentences.length === 0) {
        reasons.push(`${rule.required} is stated but its sentence could not be isolated — the check would silently pass`);
      }
      for (const sentence of sentences) {
        for (const verb of rule.negatingVerbs) {
          // Negation-aware, deliberately, and reusing the same helper the
          // `contradictedBy` half uses: the CORRECT text is "STOP and wait: do NOT
          // proceed with the workflow", which contains the negating verb inside a
          // negation. A raw regex test fired on it — the third time in this file's
          // construction that a bare substring check mistook correct prose for a
          // contradiction — so the check is the shared one, not a new one.
          if (contradictsClause(sentence, verb, { caseInsensitive: true })) {
            reasons.push(`its sentence says "${verb}" instead of stopping`);
          }
        }
      }
    }
  }
  return reasons;
}

/**
 * The rule sentences a canonical clause must state, extracted structurally.
 *
 * This replaces a blacklist, and the reason is a pattern rather than an incident:
 * four successive wordings defeated four successive enumerations of "bad words".
 *
 *   1. "PROCEED with the workflow using your best judgement"
 *   2. "CONTINUE the workflow ... the older STOP and wait / do NOT proceed wording
 *       no longer applies" — quotes the required phrases while negating them
 *   3. "STOP and wait, then continue the workflow with your best judgement"
 *   4. "STOP and wait is advisory only: feel free to resume the workflow and
 *       finish the stage" — and this one was found IN THE SOURCE, live, with the
 *      whole suite green, because "resume" and "advisory only" were not on a list
 *      that only ever grows.
 *
 * The lesson is not to lengthen the list; it is that any check which enumerates
 * forbidden wordings is defeated by the next wording. So the check is an EQUALITY
 * on the sentences themselves: the clause must state exactly the rule sentences it
 * is supposed to state, no more and no fewer. A novel inversion cannot pass an
 * equality check, because it is by definition a different sentence.
 *
 * `keep` selects the sentences that carry rules, and the two constants below are
 * the pinned corpus. Rewrapping inside a sentence is free (`normalizeClause`
 * collapses whitespace), so a size change can still reflow the prose. Changing
 * what a rule SAYS means updating the pin, which is the moment a person reads the
 * rule and confirms it still means what it meant — the review the drift skipped.
 */
export function ruleSentences(clause, { minChars = 40 } = {}) {
  return normalizeClause(clause)
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= minChars);
}

/**
 * Which pinned sentences are missing from a rendered prompt, and which unpinned
 * sentences it carries.
 *
 * Both halves matter and they are different failures: `missing` is a rule that
 * stopped being stated (or was rewritten into something else), and `extra` is a
 * rule nobody agreed to — including an inverted restatement of a pinned one, which
 * arrives as an `extra` sentence alongside the intact original.
 *
 * Returns `{ missing, extra }`; both empty means the clause states exactly its
 * pinned rules.
 */
export function pinnedSentenceDiff(rendered, pinned, { minChars = 40 } = {}) {
  const present = new Set(ruleSentences(rendered, { minChars }));
  const expected = new Set(pinned.map((sentence) => normalizeClause(sentence)));
  const missing = [...expected].filter((sentence) => !present.has(sentence));
  const extra = [...present].filter((sentence) => !expected.has(sentence));
  return { missing, extra };
}

/** The first sentence of a clause, used as its identity probe. */
function firstSentence(text) {
  const normalized = normalizeClause(text);
  if (!normalized) return "";
  const stop = normalized.search(/\.(\s|$)/);
  return stop < 0 ? normalized : normalized.slice(0, stop + 1);
}

/**
 * Sentences repeated verbatim inside one rendered prompt.
 *
 * The ask contract is a block that grew by accretion, and a block that grew by
 * accretion says the same rule twice: "never re-ask the same question" and
 * "batch independent questions" are each stated in more than one paragraph in
 * at least one builder. A reader — and a model — pays for both. Only sentences
 * long enough to be a rule are counted; short fragments ("--multiple`") repeat
 * legitimately inside a command example.
 */
export function repeatedSentences(rendered, { minChars = 60 } = {}) {
  const sentences = normalizeClause(rendered)
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= minChars);
  const seen = new Map();
  for (const sentence of sentences) seen.set(sentence, (seen.get(sentence) ?? 0) + 1);
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([sentence, count]) => ({ sentence, count }));
}

/**
 * Boilerplate repeated across spawn paths.
 *
 * This is the fleet-level reading of the five builders: a paragraph that is
 * byte-identical in three of them is a paragraph maintained in three places,
 * which is how the ask contract drifted. Percentage of each path's text that is
 * shared is the number to watch — it says how much of a prompt is not specific
 * to the path that renders it.
 */
export function sharedAcrossPaths(paths) {
  const canonical = new Map();
  for (const [path, rendered] of Object.entries(paths)) {
    const paragraphs = normalizeClause(rendered)
      .split(/(?<=\n)|(?<=\.)\s+/)
      .map((part) => normalizeClause(part))
      .filter((part) => part.length >= 120);
    for (const paragraph of new Set(paragraphs)) {
      if (!canonical.has(paragraph)) canonical.set(paragraph, new Set());
      canonical.get(paragraph).add(path);
    }
  }
  const pathsByName = Object.keys(paths);
  const shared = [...canonical.entries()]
    .filter(([, holders]) => holders.size > 1)
    .map(([paragraph, holders]) => ({
      paragraph,
      paths: [...holders].sort(),
      chars: paragraph.length,
    }))
    .sort((a, b) => b.chars - a.chars);
  const duplicatedChars = shared.reduce((sum, entry) => sum + entry.chars * (entry.paths.length - 1), 0);
  const totalChars = pathsByName.reduce((sum, name) => sum + paths[name].length, 0);
  return {
    shared,
    duplicatedChars,
    totalChars,
    /** The share of all rendered prompt text that exists only because a second
     * path renders the same words again. Lower is a prompt maintained in one
     * place; higher is a suite of prompts maintained by hand. */
    duplicationRatio: totalChars > 0 ? duplicatedChars / totalChars : 0,
  };
}

/** The whole budget report for one spawn path, in the shape a test or an
 * autoresearch `measure.sh` reads. `clauses` is optional: a path measured only
 * for size passes none. */
export function promptBudget(rendered, { clauses = {}, path = "prompt" } = {}) {
  const chars = typeof rendered === "string" ? rendered.length : 0;
  const clauseEntries = Object.fromEntries(
    Object.entries(clauses).map(([name, clause]) => [name, clauseCost(clause.text ?? clause)]),
  );
  const repeated = bytesUnlessEmpty(rendered) ? repeatedSentences(rendered) : [];
  return {
    path,
    chars,
    estimatedTokens: estimateTokens(rendered),
    clauseChars: Object.values(clauseEntries).reduce((sum, entry) => sum + entry.length, 0),
    clauseEntries,
    repeatedSentences: repeated,
    repeatedChars: repeated.reduce((sum, entry) => sum + entry.sentence.length * (entry.count - 1), 0),
  };
}

function bytesUnlessEmpty(text) {
  return typeof text === "string" && text.length > 0;
}
