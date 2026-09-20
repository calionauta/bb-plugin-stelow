/**
 * Claim-first dedupe for GitHub imports (`github_imports`).
 *
 * Concurrent flows (manual click vs scheduler tick) cannot both pass a
 * check-then-insert: the key is claimed with an owner token BEFORE any
 * work starts, atomically (INSERT OR IGNORE + conditional UPDATE are
 * each single statements). Exactly one flow owns the key; losers read
 * the contending row and let the caller decide already-imported vs
 * in-flight via a liveness check it owns.
 *
 * Takes `db` like card-claims.mjs; tested against :memory: with
 * interleaved racers. Shape of the table is owned by the caller
 * (server/github-issues.ts migrations).
 */

export function acquireGithubImportClaim(db, { key, repo, number, label, token, now }) {
  db.prepare(
    "INSERT OR IGNORE INTO github_imports (issue_key, repo, number, label, card_id, imported_at, claimed_by) VALUES (?, ?, ?, ?, NULL, ?, NULL)",
  ).run(key, repo, number, label, now);
  const claimed = db.prepare(
    "UPDATE github_imports SET claimed_by = ? WHERE issue_key = ? AND card_id IS NULL AND claimed_by IS NULL",
  ).run(token, key);
  if (claimed.changes === 1) return { owned: true, cardId: null };
  const row = db.prepare("SELECT card_id FROM github_imports WHERE issue_key = ?").get(key);
  return { owned: false, cardId: row?.card_id ?? null };
}

export function completeGithubImport(db, { key, token, cardId, label, now }) {
  const done = db.prepare(
    "UPDATE github_imports SET card_id = ?, label = ?, imported_at = ?, claimed_by = NULL WHERE issue_key = ? AND claimed_by = ?",
  ).run(cardId, label, now, key, token);
  return done.changes === 1;
}

export function releaseGithubClaim(db, { key, token }) {
  db.prepare(
    "UPDATE github_imports SET claimed_by = NULL WHERE issue_key = ? AND claimed_by = ? AND card_id IS NULL",
  ).run(key, token);
}

/**
 * Liveness behind the single dedupe: a key counts as imported only with
 * a card row still behind it (verified by existence, never by a bare
 * non-null — FKs are off unless the host enables them, so a dangling
 * card_id must read as not-imported), or an in-flight claim (NULL card
 * WITH a token — someone is creating it right now). Cardless, claimless
 * rows (deleted cards, released crashes) read as not-imported so the
 * issue can come back.
 * Contract: one token per attempt, never re-acquire — a second acquire
 * with the same token reads as contended, not owned.
 */
export function liveImportedKeys(db) {
  return new Set(
    db.prepare(
      "SELECT issue_key FROM github_imports WHERE card_id IN (SELECT id FROM cards) OR (card_id IS NULL AND claimed_by IS NOT NULL)",
    ).all().map((row) => row.issue_key),
  );
}
