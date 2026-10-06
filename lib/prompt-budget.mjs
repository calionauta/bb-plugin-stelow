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

/**
 * How much of a prompt a provider can serve from cache when the SAME app spawns a
 * worker for a DIFFERENT card.
 *
 * This is the metric that matters most and was missing entirely. Provider caching
 * is prefix matching: the cacheable region ends at the first byte that differs. So
 * the question is not how much text is shared but where the first per-card value
 * sits, and a template is cache-hostile in exact proportion to how early it
 * interpolates something card-specific.
 *
 * Measured on this repo's five builders, two different cards: 129 of 12,082
 * characters were cacheable — **1.1%** — because the interpolated state dir lands
 * about 190 characters in. The same clauses, reordered so every shared clause
 * precedes every per-card value, are **99%** cacheable. Same tokens in the prompt,
 * same rules stated, 78x the reusable region, for a reordering.
 *
 * `prefixOf` takes the two prompts; the caller decides which pair matters (two
 * cards, two bands of one card, two restarts).
 */
export function cacheablePrefix(a, b) {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

/**
 * Where a prompt stops being cacheable when the next worker is spawned for a
 * different card.
 *
 * `total` is the prompt's length, `prefix` the shared run, `ratio` the share a
 * provider could have reused. `divergedAt` shows the text around the first
 * difference, which is the value to move: the fix is almost always to interpolate
 * that value later rather than to delete anything.
 */
export function cacheReport(a, b, { label = "prompt" } = {}) {
  const prefix = cacheablePrefix(a, b);
  const total = Math.min(a.length, b.length);
  return {
    label,
    total,
    prefix,
    ratio: total > 0 ? prefix / total : 0,
    divergedAt: `${a.slice(Math.max(0, prefix - 50), prefix)}|${a.slice(prefix, prefix + 30)}`,
  };
}

/**
 * The clause ORDER of a rendered prompt, by position.
 *
 * Exists so a test can pin the property that produces the cache win rather than
 * the win itself: shared clauses must precede per-card values. A test that pinned
 * the ratio would need two fixtures and would fail on any legitimate clause edit;
 * one that pins order states the rule and survives rewording.
 */
export function positionOf(rendered, needle) {
  return normalizeClause(rendered).indexOf(normalizeClause(needle));
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
