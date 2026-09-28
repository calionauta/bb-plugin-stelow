/**
 * A lock block, as a fact, and the sentence derived from it.
 *
 * A card whose file is held by another card is told so in a sentence:
 *
 *   Waiting on src/foo.ts (held by card "Restore archived cards to board
 *   columns"). Releases automatically when that card finishes the file or by
 *   <when> — no action needed.
 *
 * The holder's card id was on the wire at the call site and thrown away into
 * that string, so the reader had to copy a display name and hunt the card on a
 * board of dozens. It is the same failure shape as the execution reconciler
 * writing `unknown-native-state` where a known state was in hand: one fact,
 * two representations, and the one that survives is the one that cannot be
 * used.
 *
 * So the record is the truth and the prose is DERIVED from it, by this module,
 * every time. A writer cannot record one holder and render another, because it
 * has only one value to pass. The inbox row links the holder from
 * `holderCardId` and never parses the sentence.
 */

/**
 * One file, held by one card, until a time.
 *
 * @typedef {object} LockBlock
 * @property {string} cardId       the card being told it cannot proceed
 * @property {string} file         the file it needs
 * @property {string} holderCardId the card holding it — the affordance, and the only real identity
 * @property {string} holderName   the holder's display name, for the sentence. Never the link target
 * @property {number} expiresAt    when the claim lapses regardless: the backstop, not the plan
 */

/**
 * The sentence, from the record.
 *
 * Says "no action needed" because that is the truth of the mechanism: release
 * resumes the card automatically, and the TTL is a backstop rather than
 * something a person is expected to wait for. A notification that implies
 * homework the system will do on its own trains people to distrust the badge.
 */
export function lockBlockSummary(block) {
  const when = new Date(block.expiresAt).toLocaleString();
  return `Waiting on ${block.file} (held by card "${block.holderName}"). `
    + `Releases automatically when that card finishes the file or by ${when} — no action needed`;
}

/** The dedupe key: one notification per card per file, however often it retries. */
export function lockBlockDedupeKey(block) {
  return `lock-blocked:${block.cardId}:${block.file}`;
}

/**
 * The inbox row that records it.
 *
 * The columns carry the affordance; the summary carries the meaning; both come
 * from the one record, so they cannot disagree. The agent-only PARK payload is
 * deliberately NOT here: it lives in card-claims, it is not duplicated, and it
 * has its own tests. Moving it would be refactoring working, tested code to
 * make a module tidier — which is the shape of work that pays for itself in
 * risk rather than in clarity.
 */
export function lockBlockEvent(block) {
  return {
    summary: lockBlockSummary(block),
    dedupeKey: lockBlockDedupeKey(block),
    holderCardId: block.holderCardId,
    holderFile: block.file,
  };
}
