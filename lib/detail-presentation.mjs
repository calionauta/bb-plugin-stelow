import { cardIsStalled } from "./card-stall.mjs";
import { formatDuration } from "./card-metrics.mjs";
import { isDoneStatus } from "./trackables.mjs";

export function joinStrategyLabels(ids, byId) {
  const labels = [];
  for (const id of ids) {
    const label = (id && byId.get(id)) || id;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.length > 0 ? labels.join(" + ") : null;
}

/**
 * How a status LOOKS, which is deliberately shared across axes.
 *
 * `statusTone` is called with a card's status and with a scope's or task's, so
 * it answers for statuses from different vocabularies — and that is correct,
 * because appearance is the one thing that does not need an axis: a finished
 * card and a finished scope are both green, and a blocked task and a blocked
 * card are both red. A reader learns that colour once.
 *
 * Both branches below used to mention `approved`, a scope MAP status that no
 * axis can produce: `assertCardStatus` refuses it on a card write and
 * `normalizeStatus` coerces it to `pending` for a scope. The branch was
 * unreachable and read as though a card could be approved, which is the confusion
 * this module exists to prevent. `archived` stays, because that one IS a card
 * status — tone and glyph are the axis-agnostic half and a card is one of the
 * axes they answer for.
 *
 * This is the line that keeps the rest of the status work honest. NAMES are
 * axis-specific and live with their axis (`TRACKABLE_STATUS_LABELS` in
 * lib/trackables.mjs), because "archived" on a card and "archived" on a pendency
 * are different words and must not share one entry. Tone and glyph are
 * axis-agnostic and live here. Putting a name in this module, or a trackable
 * label in a component, is how the two halves get confused again.
 */
export function statusTone(status) {
  if (["completed", "done"].includes(status)) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (status === "in-progress") return "bg-primary/15 text-primary";
  if (["blocked", "failed"].includes(status)) return "bg-destructive/15 text-destructive";
  if (status === "escalated") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (["skipped", "archived"].includes(status)) return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
  return "bg-muted text-muted-foreground";
}

/**
 * The glyph that carries a status's meaning without colour.
 *
 * Beside `statusTone` for the same reason and with the same axis-agnostic
 * reach: shape is a second channel for the same facts, so a status that reads
 * "finished" by tone must also read as finished in a monochrome screenshot, in
 * high-contrast mode, and to someone who cannot see the colour at all.
 *
 * Terminal-good first, because ✓ and ↷ are the two shapes that say "nothing more
 * is coming" — the thing a reader scans a status column for. Escalation gets ↑
 * rather than ✗ on purpose: it is a stop someone must resolve, not a failure
 * that already happened.
 */
export function statusGlyph(status) {
  if (isDoneStatus(status)) return "✓";
  if (status === "skipped") return "↷";
  if (status === "escalated") return "↑";
  if (status === "failed") return "✗";
  if (status === "blocked") return "⚠";
  if (status === "in-progress") return "●";
  return status === "archived" ? "○" : "·";
}

/**
 * The border tone for a card, by what is happening to it.
 *
 * Order is the whole point. An error outranks attention, because a card that
 * is broken is not waiting for anything — it has stopped, and retrying is the
 * opposite action from answering. `card_e3u00eb4` had no error branch at all
 * and fell through to attention, so a worker that said it would not start a
 * cycle it could not finish looked identical to a card holding a question.
 */
export function liveBorderClass(card) {
  if (card.activity === "error") return "stelow-border-error";
  if (card.activity === "running") return "stelow-border-running";
  if (card.activity === "awaiting-answer" || card.needsAttention) return "stelow-border-attention";
  return "";
}

/**
 * The one line a card shows about being stopped, or null when nothing is.
 *
 * An error with no recorded reason still says it stopped. `last_error` is
 * empty on a card whose worker chose to halt rather than fail, and "the worker
 * stopped" is a true thing to tell a reader where an empty string is not.
 */
export function errorActivityLabel(card) {
  if (card.activity !== "error") return null;
  const reason = (card.lastError ?? "").trim();
  return reason
    ? { label: "Stopped with an error", detail: reason }
    : {
      label: "Stopped",
      detail: "The worker stopped without recording a reason. Open the card for its last message.",
    };
}

/**
 * The one line a card shows about being paused, or null when nothing is.
 *
 * `card_e3u00eb4` collected eight `paused` inbox entries and the board showed
 * none of them. The record was correct and invisible, which is the same
 * failure as the error one: the fact exists, and the board does not render it.
 *
 * A pause is not a failure and not a question. The worker ran out of things
 * it could do, and a reader needs to know it is waiting for them — the retry
 * and restart rows already say what the two options do, so this only has to
 * name the state.
 */
export function pausedActivityLabel(card) {
  if (!cardIsStalled(card)) return null;
  return {
    label: "Paused. Resume it.",
    detail: "The worker has no more output and is waiting for you. Resume continues where it stopped; restart begins again.",
  };
}

/**
 * How long a card has been waiting for a person, or null when it is not.
 *
 * A duration, never a date. The tile used to print `Updated 10/19/2026,
 * 3:01:31 AM` in a `shrink-0` span on a one-line flex row, so the absolute
 * string — which is as wide as it is verbose and wider than the column — pushed
 * the project name out of the tile and then ran off the edge of it. "2d 4h"
 * answers the question the row is asking (how long has this been like this)
 * and stops growing after two units. The exact instant is still one hover away,
 * as an absolute timestamp on the same element.
 *
 * It measures from `lastIdleAt`, which is when the worker stopped, not from
 * `updatedAt`, which is when the row was last written — a sync poll bumps the
 * second without the card having moved, so measuring the wait from it reports
 * an idle card as freshly idle forever ("Idle since 3:01" on a card that has
 * been stopped for two days). `lastIdleAt` was already the field the host uses
 * to decide the card needs attention at all (`server/cards.ts`), so the tile
 * and the host now answer from one clock.
 */
export function idleDurationLabel(card, now = Date.now()) {
  if (card.activity !== "idle") return null;
  const since = typeof card.lastIdleAt === "number" && card.lastIdleAt > 0
    ? card.lastIdleAt
    : card.updatedAt;
  if (typeof since !== "number" || !Number.isFinite(since)) return null;
  return formatDuration(Math.max(0, now - since));
}
