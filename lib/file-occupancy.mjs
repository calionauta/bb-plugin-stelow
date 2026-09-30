/**
 * Who else is in this card's files, as one sentence per fact.
 *
 * The claim ledger already knows the answer for cards: `card_claims` records
 * every (workspace, file, card, scope) a worker reserved, and `lock check`
 * reads it to refuse a conflict. What it never had was a way to ASK. The
 * reader only ever learned about a collision after one happened — the lock
 * wall named the holder in the failure, and nothing showed who was already
 * there.
 *
 * So this is the same query, asked on purpose. It is presentation, not
 * enforcement: the claims are already enforced at acquire time, and this
 * changes no decision. What it adds is the one thing a conflict notification
 * cannot: the state BEFORE the conflict.
 *
 * A card in a managed worktree is the case this is quiet about. Isolation
 * means no other card can reach those files, and the honest answer is "nobody"
 * rather than a scan that could never find anything. Isolation replaces
 * exclusion, exactly as the lock protocol already says.
 */

const EXPIRED_LABEL = "expired";

function holderShape(holder) {
  if (!holder || typeof holder !== "object") return null;
  const cardId = typeof holder.cardId === "string" ? holder.cardId : null;
  if (!cardId) return null;
  return {
    cardId,
    scope: typeof holder.scope === "string" && holder.scope ? holder.scope : null,
    expiresAt: typeof holder.expiresAt === "number" ? holder.expiresAt : null,
  };
}

/**
 * Group claim rows by the file they are about.
 *
 * One file can have several holders: two scopes of different cards, or two
 * cards whose scopes overlap. The reader is asking "who is in this file", and
 * the answer is a list, not a winner — a file with two holders is exactly the
 * case worth seeing.
 */
export function fileOccupancy(claimRows, { nowMs = Date.now() } = {}) {
  const byFile = new Map();
  for (const row of Array.isArray(claimRows) ? claimRows : []) {
    if (!row || typeof row.file_path !== "string" || !row.file_path) continue;
    const holder = holderShape({
      cardId: row.card_id,
      scope: row.scope,
      expiresAt: row.expires_at,
    });
    if (!holder) continue;
    const list = byFile.get(row.file_path) ?? [];
    // The same card appearing twice for one file is one holder holding it
    // through two leases, not two holders.
    if (list.some((entry) => entry.cardId === holder.cardId && entry.scope === holder.scope)) continue;
    list.push(holder);
    byFile.set(row.file_path, list);
  }
  return [...byFile.entries()]
    .map(([file, holders]) => ({
      file,
      holders,
      expired: holders.every((holder) => typeof holder.expiresAt === "number" && holder.expiresAt <= nowMs),
    }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * The line for one file, derived from the record rather than written beside
 * it — the rule `lock-blocked` follows, for the same reason: a writer that
 * holds one holder and renders another is a writer that can disagree with
 * itself.
 */
export function fileOccupancyLine(entry, { thisCardId = null } = {}) {
  const others = entry.holders.filter((holder) => holder.cardId !== thisCardId);
  if (others.length === 0) return null;
  const who = others
    .map((holder) => (holder.scope ? `card "${holder.scope}"` : "another scope"))
    .join(" and ");
  const when = entry.expired
    ? " (lapsed — nothing is holding it right now)"
    : others[0] && typeof others[0].expiresAt === "number"
      ? ` until ${new Date(others[0].expiresAt).toLocaleString()}`
      : "";
  return `${entry.file} is also held by ${who}${when}`;
}

/**
 * The whole answer for a card: the lines, and whether there is anything to
 * say at all. An empty list is a real answer in a shared workspace, and an
 * empty list under isolation is a wasted disclosure — so the caller is told
 * which case it is.
 */
export function cardFileOccupancy(claimRows, { cardId = null, workspacePath = null, isolated = false, nowMs = Date.now() } = {}) {
  if (isolated) {
    return { isolated: true, files: [], lines: [], shared: 0 };
  }
  const files = fileOccupancy(claimRows, { nowMs });
  const lines = files
    .map((entry) => fileOccupancyLine(entry, { thisCardId: cardId }))
    .filter((line) => line !== null);
  return {
    isolated: false,
    files: files.filter((entry) => entry.holders.some((holder) => holder.cardId !== cardId)),
    lines,
    shared: lines.length,
    workspacePath: typeof workspacePath === "string" ? workspacePath : null,
  };
}
