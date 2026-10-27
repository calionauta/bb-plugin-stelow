import type { ReactNode } from "react";
import { ItemActions } from "./inbox-item-actions";
import { Button } from "../ui/button";
import { splitProseSummary } from "../../lib/question-prose.mjs";
import {
  inboxDisplayReasons,
  inboxEventPresentation,
  inboxEventText,
  inboxEventTime,
} from "../../lib/inbox-event-presentation.mjs";
import { inboxAction } from "../../lib/inbox-panel-state.mjs";
import { INBOX_EVENT_LABELS } from "../../lib/inbox-event-presentation.mjs";
import type { InboxNotification } from "./inbox-types";

const INBOX_COPY: Record<InboxNotification["kind"], { icon: string; label: string; tone: string }> = {
  question: { icon: "?", label: INBOX_EVENT_LABELS.question, tone: "bg-amber-500/15 text-amber-700" },
  error: { icon: "!", label: INBOX_EVENT_LABELS.error, tone: "bg-destructive/15 text-destructive" },
  paused: { icon: "Ⅱ", label: INBOX_EVENT_LABELS.paused, tone: "bg-amber-500/15 text-amber-700" },
  completed: { icon: "✓", label: INBOX_EVENT_LABELS.completed, tone: "bg-emerald-500/15 text-emerald-700" },
};

/**
 * The Inbox row and the parts it is made of.
 *
 * Split out of `inbox-panel.tsx` when the row gained the question line and the
 * second door: the panel owns filtering, loading and the list, and the row owns
 * what one notification looks like and what clicking it means.
 *
 * The row's CLICK always means the card. The narrow door onto a question is a
 * separate, named affordance (`Answer`), because a row whose click meant two
 * different things depending on the viewport would be worse than one door.
 */

function InboxEntryHeader({ entry, label, stateLabel }: {
  entry: InboxNotification;
  label: string;
  stateLabel: string | null;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <strong className="text-sm">{entry.cardName}</strong>
      {stateLabel ? (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
      ) : null}
      {entry.severity >= 2 && entry.resolvedAt == null ? (
        <span
          className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
          title={entry.severityReasons.join(" · ")}
        >
          escalating
          {entry.severityReasons.length > 0 ? (
            <span className="sr-only">: {entry.severityReasons.join(", ")}</span>
          ) : null}
        </span>
      ) : null}
      {!entry.readAt ? (
        <span className="size-1.5 rounded-full bg-primary">
          <span className="sr-only">Unread</span>
        </span>
      ) : null}
    </span>
  );
}

// What the item says, in the order a reader needs it: who it is about, what
// it says, why it escalated, and when. Split from the row so the row owns
// only the click targets.
/**
 * The row's second line: the ask itself when it was captured, the event text
 * otherwise.
 *
 * The cut is the SAME function and limit the card uses (`splitProseSummary`), so
 * the Inbox and the card can never drift into two truncation rules, and the
 * whole question stays in `title` for anyone who needs it without opening
 * anything. Split out of `InboxEntryBody` when the row gained this line and the
 * function went over its budget.
/**
 * The row's second line: the ask itself when it was captured, the event text
 * otherwise.
 *
 * Two things about this line are deliberate and were both wrong in a UX review
 * before they were fixed here:
 *
 * - It CLAMPS to two lines instead of `truncate`. The head is already a cut
 *   (first sentence, `PROSE_SUMMARY_LIMIT`), and CSS ellipsis on top of that
 *   meant a two-clause question like "...the staging database or the production
 *   replica?" showed the lead-in and hid the choice — the part that decides
 *   which row to open.
 * - The whole question is on `aria-label`, not only `title`. A `title` is
 *   hover-only and is not reliably announced, so a screen-reader user got the
 *   already-cut head and nothing else. The label carries the full text; `title`
 *   stays as the mouse affordance.
 *
 * The cut is the SAME function and limit the card uses, so the Inbox and the
 * card can never drift into two truncation rules. Split out of `InboxEntryBody`
 * when the row gained this line and the function went over its budget.
 */
function InboxEntryLine({ entry }: { entry: InboxNotification }) {
  const question = typeof entry.questionSummary === "string" ? entry.questionSummary.trim() : "";
  if (!question) return <span className="mt-0.5 block text-sm text-muted-foreground">{inboxEventText(entry)}</span>;
  const more = typeof entry.questionCount === "number" && entry.questionCount > 1 ? entry.questionCount : null;
  return (
    // No `block` beside `line-clamp-2`: both compile into `@layer utilities`
    // at equal specificity, and `.block{display:block}` sits AFTER the clamp
    // rule in the built stylesheet, so the clamp's own `display:-webkit-box`
    // never applied and the two-line cap has never worked at any width. Doing
    // it again reads as a harmless display hint and silently unclamps the row.
    <span className="mt-0.5 flex items-baseline gap-1">
      <span
        className="line-clamp-2 min-w-0 text-sm text-foreground"
        title={question}
        aria-label={more ? `${question} Plus ${more - 1} more question${more - 1 === 1 ? "" : "s"}.` : question}
      >
        {splitProseSummary(question).head}
      </span>
      {more ? (
        // Outside the clamped span on purpose. A count rendered inside it is
        // the first thing the cap cuts: measured at 360 px the suffix sat 56 px
        // below the clamp box, so a row covering three questions showed two and
        // said nothing about the rest — exactly when the cap started working.
        <span className="shrink-0 text-xs text-muted-foreground">+{more - 1} more</span>
      ) : null}
    </span>
  );
}

function InboxEntryBody({ entry, presentation, onHolderChip }: {
  entry: InboxNotification;
  presentation: ReturnType<typeof inboxEventPresentation>;
  onHolderChip: (entry: InboxNotification) => ReactNode;
}) {
  // Severity chips that merely restate the row's own label are noise, not
  // signal — only reasons that add information survive the filter.
  const reasons = inboxDisplayReasons(entry);
  return (
    <span className="min-w-0">
      <InboxEntryHeader entry={entry} label={presentation.label} stateLabel={presentation.stateLabel} />
      <InboxEntryLine entry={entry} />
      {entry.holderCardId ? onHolderChip(entry) : null}
      {reasons.length > 0 && entry.resolvedAt == null ? (
        <span className="mt-1 block text-xs text-muted-foreground">
          {reasons.slice(0, 3).join(" · ")}
        </span>
      ) : null}
      <span className="mt-1 block text-xs text-muted-foreground" title={new Date(presentation.stateAt).toLocaleString()}>
        {entry.projectName} · {inboxEventTime(entry)}
      </span>
    </span>
  );
}

export type InboxEntryProps = {
  entry: InboxNotification;
  onOpen: () => void;
  /** The narrow door, or null where the gate refuses it. */
  onOpenAsk: (entry: InboxNotification) => (() => void) | null;
  onHolderChip: (entry: InboxNotification) => ReactNode;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onSetAside: () => void;
  onBringBack: () => void;
};

/**
 * The row's main click target: the notification itself.
 *
 * Two affordances on one element, and the pairing is deliberate. The CLICK
always opens the card — one click, one meaning, at every viewport. `Enter` is
the explicit second door onto the question alone, available only where the gate
allows it, so the row never means two different things depending on the screen.
 */
function InboxEntryTarget({ entry, copy, ask, onOpen, onHolderChip }: {
  entry: InboxNotification;
  copy: { icon: string; tone: string };
  ask: (() => void) | null;
  onOpen: () => void;
  onHolderChip: (entry: InboxNotification) => ReactNode;
}) {
  return (
    // A raw button on purpose, not `ui/Button`: this is a full-width row target
    // wrapping a two-line body, and the shared Button's inline-flex/centered
    // shape would fight the layout. The touch height and the pointer cursor are
    // therefore stated IN the tag rather than in a class constant — the density
    // census reads the tag, and a requirement hidden in a constant reads to it
    // as a missing one (that is exactly how this was caught).
    <button
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!ask) return;
        if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        ask();
      }}
      className={
        // `grow basis-[16rem]`, never `flex-1`: flex-1 is `flex-basis: 0`, which
        // is exactly the permission the row needs to withhold so the text keeps
        // a measure and the action cluster takes a second line instead. The
        // class list is a plain concatenation (not cn()), so a leftover flex-1
        // would not be deduped — it would lose only on stylesheet order.
        "flex min-h-11 min-w-0 grow basis-[16rem] cursor-pointer items-start gap-3 rounded-sm text-left "
        + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      }
    >
      <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${copy.tone}`}>
        {copy.icon}
      </span>
      <InboxEntryBody entry={entry} presentation={inboxEventPresentation(entry)} onHolderChip={onHolderChip} />
    </button>
  );
}

/**
 * The row's action cluster, as ONE node.
 *
 * The wrapper is the whole point: `ItemActions` returns a fragment, so without
 * it the row had no element to move onto a second line and no element a test
 * could assert. `ml-auto` is the cluster's resting place at both widths —
 * right of the text when the row fits, and the right edge under the text when
 * it wraps, so "Set aside" does not become the most reachable control in the
 * bottom-left corner. Its own `flex-wrap` is the overflow fallback: a narrower
 * host panel or a larger browser text size makes the buttons wrap among
 * themselves instead of pushing past the row's edge. That fallback only works
 * because the cluster can shrink (`min-w-0`) — a `shrink-0` cluster keeps its
 * content width at every container size, so its `flex-wrap` would never have
 * anything to wrap and the row would overflow by the difference instead.
 */
function InboxRowActions({ ask, entry, action, onMarkRead, onMarkUnread, onSetAside, onBringBack }: {
  ask: (() => void) | null;
  entry: InboxNotification;
  action: "archive" | "restore";
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onSetAside: () => void;
  onBringBack: () => void;
}) {
  return (
    <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
      {ask ? (
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          onClick={ask}
          title="Answer on its own, without opening the card"
        >
          Answer
        </Button>
      ) : null}
      <ItemActions
        entry={entry}
        action={action}
        onMarkRead={onMarkRead}
        onMarkUnread={onMarkUnread}
        onSetAside={onSetAside}
        onBringBack={onBringBack}
      />
    </div>
  );
}

export function InboxEntry({
  entry,
  onOpen,
  onOpenAsk,
  onHolderChip,
  onMarkRead,
  onMarkUnread,
  onSetAside,
  onBringBack,
}: InboxEntryProps) {
  const copy = INBOX_COPY[entry.kind];
  const action = inboxAction(entry);
  // The second door, offered only where the gate allows it.
  const ask = onOpenAsk(entry);
  return (
    // `flex-wrap` is what lets the cluster leave the text's line; it does
    // nothing on its own, because the target's old `flex-1` (basis 0) never
    // asked for a break. The measure on the target is the mechanism, wrapping
    // is the consequence — and both follow the row's own width, so a narrow
    // docked panel on a desktop reflows exactly like a phone does.
    <div className={`flex flex-wrap items-start gap-2 p-3 sm:gap-3 ${entry.readAt ? "bg-background" : "bg-amber-500/5"}`}>
      <InboxEntryTarget entry={entry} copy={copy} ask={ask} onOpen={onOpen} onHolderChip={onHolderChip} />
      <InboxRowActions
        ask={ask}
        entry={entry}
        action={action}
        onMarkRead={onMarkRead}
        onMarkUnread={onMarkUnread}
        onSetAside={onSetAside}
        onBringBack={onBringBack}
      />
    </div>
  );
}

