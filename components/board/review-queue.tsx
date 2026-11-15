import { useCallback, useRef } from "react";
import { TEXT_META } from "../../lib/design-tokens";
import { queueBadgeAria } from "../../lib/review-queue.mjs";
import { Button } from "../ui/button";
import { ReviewQueueRail } from "./review-queue-rail";
import {
  useReviewQueue,
  type ReviewQueueCard,
  type ReviewQueueRpc,
  type ReviewQueueState,
} from "./use-review-queue";

/**
 * The review queue's trigger and its rail, in one place.
 *
 * The trigger is the reading: a count and the oldest wait, on the board's chrome
 * beside the flow line, visible while the rail is shut. That is the whole reason
 * this exists — a gate column tells a reader a card is *somewhere*, and this
 * tells them a card has been there for six days and it is their turn.
 *
 * The rail is `fixed`, so opening it costs the board nothing: no column narrows,
 * no track gains padding, and the horizontal scroll position the reader left is
 * the one they come back to. That is asserted, not assumed
 * (`tests/review-queue-layout.test.mjs`).
 *
 * Closing returns focus to the trigger. A rail that closes and drops focus on
 * `<body>` loses a keyboard reader's place, which is precisely the bug the
 * surrounding components have already been fixed for.
 */
type ReviewQueueProps = {
  rpc: ReviewQueueRpc;
  cards: ReadonlyArray<ReviewQueueCard>;
  onOpenCard: (cardId: string) => void;
};

export const REVIEW_QUEUE_TRIGGER_ID = "review-queue-trigger";
export const REVIEW_QUEUE_RAIL_ID = "review-queue-rail";

const TRIGGER_CLASS =
  "h-auto min-h-11 w-full flex-wrap justify-start gap-2 whitespace-normal px-0 py-0 text-xs font-normal";

export function ReviewQueue({ rpc, cards, onOpenCard }: ReviewQueueProps) {
  const queue = useReviewQueue(rpc, cards);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { close } = queue;
  const closeAndReturn = useCallback(() => {
    close();
    triggerRef.current?.focus();
  }, [close]);
  return (
    <>
      <div className="rounded-md border bg-muted/20 px-3 py-2">
        <QueueTrigger queue={queue} triggerRef={triggerRef} />
      </div>
      <ReviewQueueRail
        id={REVIEW_QUEUE_RAIL_ID}
        open={queue.open}
        rows={queue.rows}
        badge={queue.badge}
        nowMs={queue.nowMs}
        checking={queue.checking}
        ledgerOk={queue.ledgerOk}
        onRetry={queue.retry}
        onClose={closeAndReturn}
        onOpenCard={onOpenCard}
      />
    </>
  );
}

/** The board's reading of the queue, shut or open. */
function QueueTrigger(props: {
  queue: ReviewQueueState;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { queue, triggerRef } = props;
  return (
    <Button
      ref={triggerRef}
      id={REVIEW_QUEUE_TRIGGER_ID}
      type="button"
      variant="ghost"
      aria-expanded={queue.open}
      aria-controls={REVIEW_QUEUE_RAIL_ID}
      aria-label={queueBadgeAria(queue.badge, queue.checking ? "checking" : queue.ledgerOk ? "ok" : "failed")}
      onClick={queue.toggle}
      className={TRIGGER_CLASS}
    >
      <span className="font-medium text-foreground">Review queue</span>
      <span
        data-review-queue-badge
        className="rounded-full border border-border px-2 py-0.5 font-mono tabular-nums"
      >
        {queue.badge.label}
      </span>
      {/* The affordance is the button, not the chord: the visible copy says what
          the reading means and leaves the keys to the panel, which documents its
          own. `waiting on you` is only printed when the read came back and found
          something, so it never contradicts a `-` badge. */}
      {queue.ledgerOk && queue.badge.count > 0 ? (
        <span className={TEXT_META}>waiting on you</span>
      ) : null}
    </Button>
  );
}
