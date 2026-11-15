import { useCallback, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../../lib/panel-storage.mjs";
import {
  REVIEW_QUEUE_TICK_MS,
  reviewQueueBadge,
  reviewQueueRows,
} from "../../lib/review-queue.mjs";
import type {
  ReviewQueueBadge,
  ReviewQueueCard,
  ReviewQueueEvent,
  ReviewQueueRow,
} from "../../lib/review-queue.mjs";
import { usePanelData } from "../panel/panel-state-hooks";

export type { ReviewQueueCard, ReviewQueueEvent, ReviewQueueRow };

/**
 * The one read the rail needs: the inbox ledger, which says who owes each card
 * its next move and when that started.
 *
 * Typed narrowly rather than as the full contract so the surface is visible:
 * opening the queue issues this call and nothing else.
 */
export type ReviewQueueRpc = {
  call: (
    name: "listNotifications",
    input: { includeArchived: boolean },
  ) => Promise<{ notifications: ReviewQueueEvent[] }>;
};

export type ReviewQueueState = {
  open: boolean;
  toggle: () => void;
  close: () => void;
  rows: ReviewQueueRow[];
  badge: ReviewQueueBadge;
  nowMs: number;
  checking: boolean;
  ledgerOk: boolean;
  loading: boolean;
  retry: () => void;
};

const OPEN_PREFERENCE = STORAGE_KEYS.reviewQueue;

function readOpenPreference(): boolean {
  try {
    return window.localStorage.getItem(OPEN_PREFERENCE) === "true";
  } catch {
    return false;
  }
}

function writeOpenPreference(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_PREFERENCE, open ? "true" : "false");
  } catch {
    /* A blocked store loses the preference, not the rail. */
  }
}

/**
 * A keypress that belongs to a field, not to the board.
 *
 * The `q` shortcut must not fire while a reader is typing a preset name or a
 * prompt, which is the failure mode every bare key handler has.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Whether the rail is open, remembered across panel switches. */
function useOpenPreference() {
  const [open, setOpen] = useState(readOpenPreference);
  useEffect(() => {
    writeOpenPreference(open);
  }, [open]);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close, setOpen };
}

/**
 * The ledger, through `usePanelData` rather than a hand-rolled load.
 *
 * That hook is the house loader for a panel read: one load in flight, one queued
 * behind it, and a `card-state`/`inbox-changed` event re-reads it. A review
 * request that arrives while the rail is open is the ordinary case here, not a
 * poll interval — and `ledgerOk` is deliberately not the same question as
 * "loading", because an unanswered read is not an empty queue.
 */
function useLedger(rpc: ReviewQueueRpc) {
  const loadLedger = useCallback(
    async () => ({
      notifications:
        (await rpc.call("listNotifications", { includeArchived: false }))
          .notifications ?? [],
    }),
    [rpc],
  );
  const {
    data: { notifications },
    isInitialLoad,
    load,
    loadError,
    loading,
  } = usePanelData(loadLedger, {
    // The rail says itself what it could not check; a toast would be a second
    // copy of that sentence, on a surface the reader may not be looking at.
    errorMessage: null,
    notifyOnError: false,
    initialData: { notifications: [] as ReviewQueueEvent[] },
    itemCountKey: "notifications",
    realtimeChannels: ["card-state", "inbox-changed"],
  });
  return {
    notifications,
    // Three states, because two made a first paint look like a failure. A read
    // still in flight is `checking`; only a read that came back with an error is
    // `ledgerOk: false`. The rail draws a line for the first and a retry for the
    // second, and no state renders "nothing is waiting on you".
    checking: isInitialLoad && loadError === null,
    ledgerOk: !isInitialLoad && loadError === null,
    loading,
    retry: load,
  };
}

/** The clock the ages are read against; it moves without asking the server again. */
function useAgeClock() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), REVIEW_QUEUE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return nowMs;
}

/** `q` toggles the rail from anywhere that is not a text field. */
function useQueueShortcut(toggle: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "q" && event.key !== "Q") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      toggle();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle]);
}

/** Queue state: whether the rail is open, and the reading it renders. */
export function useReviewQueue(
  rpc: ReviewQueueRpc,
  cards: readonly ReviewQueueCard[],
): ReviewQueueState {
  const { open, toggle, close } = useOpenPreference();
  const { notifications, checking, ledgerOk, loading, retry } = useLedger(rpc);
  const nowMs = useAgeClock();

  const rows = useMemo(
    () => reviewQueueRows({ cards, notifications, ledgerOk }),
    [cards, ledgerOk, notifications],
  );
  const badge = useMemo(
    () => reviewQueueBadge(rows, { ledgerOk, nowMs }),
    [ledgerOk, nowMs, rows],
  );

  useQueueShortcut(toggle);

  return { open, toggle, close, rows, badge, nowMs, checking, ledgerOk, loading, retry };
}
