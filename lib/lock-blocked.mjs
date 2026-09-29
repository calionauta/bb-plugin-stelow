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
 * The card-level wait, from the per-scope `blockedFiles` the detail already
 * enriched. Null when nothing is blocked.
 *
 * This is the same join the Inbox does, read from the same per-file record
 * rather than from prose: the card and the Inbox cannot disagree about who is
 * holding what, because neither of them is told — both derive. The holder's
 * display name is resolved by the caller, which is the only part that needs
 * the database.
 *
 * One holder is named even when several cards are involved, because the
 * sentence has to stay a sentence. `holders` carries the full set so the card
 * can still link all of them.
 */
export function blockedFileWait(scopes, resolveHolderName) {
  const rows = [];
  for (const scope of Array.isArray(scopes) ? scopes : []) {
    for (const blocked of Array.isArray(scope?.blockedFiles) ? scope.blockedFiles : []) {
      if (blocked && typeof blocked === "object" && typeof blocked.file === "string") rows.push(blocked);
    }
  }
  if (rows.length === 0) return null;
  // A sibling scope of the same card is not a card the reader can go and
  // unblock: it is this card's own other scope. It is contention, and it is
  // named as such, because the card still has to say why it is waiting.
  const sameCard = rows.filter((row) => row.holderLabel === "another scope on this card");
  const foreign = rows.filter((row) => row.holderLabel !== "another scope on this card");
  // Purely internal: the holder is a sibling scope of this card, so there is
  // no card to name and no link to offer.
  if (foreign.length === 0) {
    const files = [...new Set(sameCard.map((row) => row.file))];
    return {
      files,
      holders: [],
      holderCardId: sameCard[0].heldBy,
      holderName: "another scope on this card",
      internal: true,
      expiresAt: Math.max(...sameCard.map((row) => (Number.isFinite(row.expiresAt) ? row.expiresAt : 0))),
    };
  }
  const byHolder = new Map();
  for (const row of foreign) {
    const list = byHolder.get(row.heldBy) ?? [];
    list.push(row.file);
    byHolder.set(row.heldBy, list);
  }
  // The holder blocking the most files leads: it is the one the reader is most
  // likely to be able to act on, and a stable choice beats an alphabetical one.
  const [holderCardId] = [...byHolder.entries()].sort((left, right) => right[1].length - left[1].length)[0];
  // Both halves are in `files`: the card is waiting on all of them, and a
  // sentence that named only the foreign ones would understate the wait.
  const allFiles = [...new Set(rows.map((row) => row.file))];
  return {
    files: allFiles,
    holders: [...byHolder.keys()],
    holderCardId,
    holderName: typeof resolveHolderName === "function"
      ? resolveHolderName(holderCardId)
      : holderCardId,
    internal: false,
    expiresAt: Math.max(...rows.map((row) => (Number.isFinite(row.expiresAt) ? row.expiresAt : 0))),
  };
}

/**
 * The hero's sentence for a blocked card, derived from `blockedFileWait` — the
 * same module, and therefore the same facts, as the Inbox row.
 *
 * It replaces the generic "the worker is idle with unfinished work" the hero
 * would otherwise show. That sentence is true and useless here: the reason the
 * card is idle is another card, and a reader who cannot see that has no way to
 * tell a contention from a stall.
 */
export function lockWaitCopy(wait) {
  if (!wait) return null;
  const one = wait.files.length === 1;
  const files = one ? wait.files[0] : `${wait.files.length} files`;
  // The backstop is stated, because the Inbox's sentence for the same fact
  // states it and a reader who learned to expect it is owed it here too. It is
  // the lease, not the plan: release normally comes first.
  const when = Number.isFinite(wait.expiresAt) && wait.expiresAt > 0
    ? new Date(wait.expiresAt).toLocaleString()
    : null;
  const who = wait.internal
    ? wait.holderName
    : wait.holders.length === 1
      ? `card "${wait.holderName}"`
      : `${wait.holders.length} other cards`;
  return `Waiting on ${files} held by ${who}. `
    + (when
      ? `The host resumes this card when they free, or by ${when} at the latest — no action needed.`
      : "The host resumes this card when they free — no action needed.");
}

/**
 * The whole card state a contention implies, decided here so the decision is
 * testable: the hero component is a `.tsx`, and a rule that can only be
 * asserted by reading its source is a rule nobody has checked.
 *
 * Null when nothing is blocked, which is what leaves the hero on its generic
 * idle branch.
 */
export function lockWaitHero(wait) {
  const sub = lockWaitCopy(wait);
  if (!sub) return null;
  return { kind: "paused", title: "Paused — waiting on a file", sub };
}

/**
 * What a scope says about its file claims: which it holds, which another card
 * holds, and whether it is executing with no claim at all.
 *
 * Tone is the point. "Files claimed" and "no live file claim" shipped in the
 * same muted paragraph, a dot apart, so a fault read as a footnote — a
 * reviewer scanning for red flags had nothing to catch. `held` is the quiet
 * fact, `blocked` and `missing` are the two that need a decision.
 *
 * Returns display-ready rows, so the component maps a tone to a class and
 * never decides here which is which.
 */
export function scopeClaimLines(scope) {
  const { claimFiles, blockedFiles, claimed, status } = scope && typeof scope === "object" ? scope : {};
  const held = [...new Set(Array.isArray(claimFiles) ? claimFiles : [])];
  const blocked = Array.isArray(blockedFiles) ? blockedFiles : [];
  const rows = [];
  if (held.length > 0) {
    const shown = held.slice(0, 3).join(", ");
    const overflow = held.length > 3 ? ` +${held.length - 3} more` : "";
    rows.push({
      tone: "held",
      text: `Holding ${held.length} file${held.length === 1 ? "" : "s"}: ${shown}${overflow}`,
      title: held.join(" · "),
    });
  }
  for (const entry of blocked) {
    if (!entry || typeof entry.file !== "string") continue;
    // A sibling scope of the same card is a distinct holder the registry
    // refuses on, so naming the reader's own card here would be a false
    // accusation of contention with someone else.
    const by = entry.holderLabel ?? "another card";
    rows.push({
      tone: "blocked",
      text: `${entry.file} is held by ${by} — this scope waits until it frees.`,
      title: `Held by card ${entry.heldBy}${entry.heldScope ? `, scope ${entry.heldScope}` : ""}, `
        + "released automatically when that holder finishes it or its lease expires.",
    });
  }
  // Claimed null means the card has no state dir to read claims from, which is
  // not the same as holding nothing — so absence never becomes a fault.
  if (claimed === false && status === "in-progress") {
    rows.push({
      tone: "missing",
      text: "No live file claim on this scope, though it names files it is about to write.",
      title: "The scope is running without a reservation other cards can see.",
    });
  }
  return rows;
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
