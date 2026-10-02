import type { WorkerCard } from "../workers-types.js";

/**
 * The host-read channel: how a card learns that the host has stopped answering
 * it, and how it learns that the host came back.
 *
 * Its own module because it is a separate concern wearing a dependency's
 * clothes. The sync's other writes say something about the CARD — a stage, a
 * projection, a failure — and every one of them is a verdict the plugin can
 * defend. This one says something about the READ, and the whole reason it
 * exists is that a verdict is the one thing it must not become: `last_error`
 * feeds `errorNeedsAttention` → `cardCanResume`, so a transport fault written
 * there renders "Resume work" for a fault no resume can fix, and overwriting
 * `activity` would erase the last verified projection the reader is looking at.
 *
 * It lives here, and not in the sync, so the rule "an unreadable read writes
 * nothing until it is worth reporting, and exactly one thing after" is stated
 * once and testable without the sync's 14-dependency harness. The streak that
 * decides remains the single counter, in lib/host-read-streak.mjs; nothing here
 * counts anything.
 */
type ReadChannelDeps = {
  updateCard: (cardId: string, fields: Record<string, unknown>) => void;
  /** Counts the miss and returns the streak it brings the card to. */
  noteUnreadable: (cardId: string) => number;
  /** A read came back; the outage, if any, is over. */
  noteReadable: (cardId: string) => void;
};

/**
 * A read the host never answered.
 *
 * The streak is counted every tick — the log and the threshold both need every
 * miss — but the card is told once, on the tick the streak reaches
 * READ_STREAK_WARN_AT, and not again. Six ticks is about 4.5 minutes at the 45s
 * reconcile, which is long enough that one slow read, one restarting worker or
 * one dropped connection is not a report; a warning that cries wolf is a warning
 * the reader learns to skip, and the reader here is the person who owns the
 * card.
 */
export function noteUnreadableRead(
  deps: ReadChannelDeps,
  card: WorkerCard,
  now: () => number,
  readMissUpdates: (streak: number, alreadySince: number | null, at: number) => Record<string, unknown>,
): void {
  const streak = deps.noteUnreadable(card.id);
  writeOrSkip(deps, card, readMissUpdates(streak, card.read_miss_since, now()));
}

/**
 * A read the host answered — the projection, or a verdict about the card's
 * ownership. Both mean the transport works, so both end the outage, and both
 * take the latch back off.
 *
 * The clear is as load-bearing as the set. A warning that outlives the fault is
 * a second lie: the card would sit on a stale projection telling a reader the
 * host is down when it is not, and nothing would ever take it off.
 */
export function noteReadableRead(
  deps: ReadChannelDeps,
  card: WorkerCard,
  readRecoveredUpdates: (alreadySince: number | null) => Record<string, unknown>,
): void {
  deps.noteReadable(card.id);
  writeOrSkip(deps, card, readRecoveredUpdates(card.read_miss_since));
}

/**
 * A card that left the sync's scope while the latch was on it.
 *
 * The second door out, and the only one for a card that will never be read
 * again: nothing will come back to clear an archived card's warning, so without
 * this it would sit there naming a host that came back an hour ago.
 */
export function clearLeftScopeRead(
  deps: ReadChannelDeps,
  card: WorkerCard,
  readRecoveredUpdates: (alreadySince: number | null) => Record<string, unknown>,
): void {
  writeOrSkip(deps, card, readRecoveredUpdates(card.read_miss_since));
}

/**
 * Write, or write nothing at all.
 *
 * Both update builders return an empty object when there is nothing to change —
 * a streak below the threshold, an already-latched card, a host that was never
 * missed. Passing that on would make the sync look like it writes to a card on
 * every one of the 45s ticks of an outage it has decided not to report yet, and
 * "writes nothing" has to mean nothing rather than an empty UPDATE.
 */
function writeOrSkip(
  deps: Pick<ReadChannelDeps, "updateCard">,
  card: WorkerCard,
  updates: Record<string, unknown>,
): void {
  if (Object.keys(updates).length === 0) return;
  deps.updateCard(card.id, updates);
}
