/**
 * The scope-sync notice, decided once (pure, no I/O, no host).
 *
 * A card can legitimately have no scopes. An investigation card that never
 * planned has no tech spec, and a card archived before planning has none either.
 * Those are not incidents, and a card that says so is more useful than one that
 * invents a fault.
 *
 * This card is the second place that decided this, and it decided it worse. The
 * panel rendered TWO scope-sync notices side by side: this one, reading the
 * server's own classification, and a coarser rule that inferred "planning used
 * headings instead of machine blocks" from the current stage alone. On
 * card_1fgz8lge — an investigation that went triage → select → setup → context →
 * audit, with `planning: pending` and `execution: pending` recorded in its own
 * state.md, and no spec-tech.md anywhere — the server correctly said `no-spec`,
 * this notice stayed silent, and the coarser one told the reader to rewrite a
 * spec that had never existed.
 *
 * So the classification is the decision, and there is one of them. `diagnoseScopeSync`
 * already distinguishes a spec that is missing (`no-spec`), a spec with no blocks
 * (`no-blocks`), a spec that parsed (`ok`), and a spec that exists but did not
 * sync (`unsynced`, `human-dialect`). Only the last two are a fault worth
 * interrupting a reader for, and only they say anything about how to fix it.
 *
 * Empty is also not evidence: a card with no spec and no scopes is consistent,
 * and alarming on it teaches people to ignore the notice that matters.
 */

/** The two states where scopes were expected and did not arrive. */
const ALARM_STATES = new Set(["unsynced", "human-dialect"]);

/**
 * The notice to show, or null for none.
 *
 * @param {{state: string, syncedScopes?: number, machineBlocks?: number, humanBlocks?: number, specFile?: string | null} | null | undefined} scopeSync
 * @param {{terminal?: boolean}} [options] terminal: the card already ended
 * @returns {string | null}
 */
export function scopeSyncNotice(scopeSync, { terminal = false } = {}) {
  if (!scopeSync || typeof scopeSync !== "object") return null;
  if (!ALARM_STATES.has(scopeSync.state)) return null;
  const total = scopeSync.humanBlocks || scopeSync.machineBlocks || 0;
  if (terminal) {
    return (
      `Scope sync parsed 0 of ${total} planned scopes — this card ended before tracking `
      + "was established (pre-guard format). Its audit record below is the evidence of "
      + "what was verified."
    );
  }
  if (scopeSync.state === "human-dialect") {
    const spec = scopeSync.specFile ?? "the spec";
    return (
      `Scope sync parsed 0 of ${scopeSync.humanBlocks} planned scopes — ${spec} uses headings `
      + "instead of machine blocks. Rewrite openers as [SCOPE-N] Title, resync, then advance."
    );
  }
  return (
    `Scope sync parsed 0 of ${scopeSync.machineBlocks} planned scopes — run bb stelow `
    + "sync-scopes, then advance again."
  );
}
