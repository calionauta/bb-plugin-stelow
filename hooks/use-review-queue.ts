import { useCallback, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../lib/panel-storage.mjs";
import {
  REVIEW_QUEUE_TICK_MS,
  reviewQueueBadge,
  reviewQueueGateReads,
  reviewQueueRows,
  type ReviewQueueBadge,
  type ReviewQueueEvent,
  type ReviewQueueGateRead,
  type ReviewQueueRow,
} from "../lib/review-queue.mjs";

/**
 * The review queue's state: open or shut, and what the ledger says.
 *
 * Two reads feed it and they fail differently. The cards come down with the
 * board, so they are always there — that is why a failed ledger read can still
 * render rows. The ledger is this hook's own read, and its failure is kept as
 * `ledgerOk: false` rather than as an empty array: "we could not check" and
 * "nothing is waiting" look the same on screen and mean opposite things, and the
 * projection refuses to guess which one it is holding (`lib/review-queue.mjs`).
 *
 * The ages are the only thing that moves on a tick. Nothing is refetched — a
 * panel that re-read the ledger every thirty seconds would be a poll, and the
 * board already refreshes; this is just the clock the cells are read against, so
 * a rail left open overnight does not keep saying `0d`.
 */
export type ReviewQueueRpc = {
  call: (
    name: "listNotifications",
    input: { includeArchived: boolean },
  ) => Promise<{ notifications: ReviewQueueEvent[] }>;
};

/** The slice of the card projection the queue reads. Narrow on purpose. */
export type ReviewQueueCard = {
  id: string;
  stage: string;
  displayName?: string | null;
  name?: string | null;
  activity?: string | null;
  updatedAt?: number | null;
};

export type ReviewQueueState = {
  open: boolean;
  toggle: () => void;
  close: () => void;
  rows: ReviewQueueRow[];
  gates: ReviewQueueGateRead[];
  badge: ReviewQueueBadge;
  nowMs: number;
  ledgerOk: boolean;
  loading: boolean;
  retry: () => void;
};

export function useReviewQueue(
  rpc: ReviewQueueRpc,
  cards: ReadonlyArray<ReviewQueueCard>,
): ReviewQueueState {
  const [open, setOpen] = useState(readOpenFlag);
  const ledger = useLedgerEvents(rpc);
  const nowMs = useTick();
  const rows = useMemo(
    () => reviewQueueRows({
      cards,
      notifications: ledger.events,
      ledgerOk: ledger.ok,
    }),
    [cards, ledger.events, ledger.ok],
  );
  const gates = useMemo(() => reviewQueueGateReads(rows, { ledgerOk: ledger.ok }), [rows, ledger.ok]);
  const badge = useMemo(
    () => reviewQueueBadge(rows, { ledgerOk: ledger.ok, nowMs }),
    [rows, ledger.ok, nowMs],
  );
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  useQueueShortcut(toggle);
  useEffect(() => {
    writeOpenFlag(open);
  }, [open]);
  return {
    open,
    toggle,
    close,
    rows,
    gates,
    badge,
    nowMs,
    ledgerOk: ledger.ok,
    loading: ledger.loading,
    retry: ledger.retry,
  };
}

type Ledger = {
  events: ReviewQueueEvent[];
  ok: boolean;
  loading: boolean;
  retry: () => void;
};

/**
 * The inbox ledger, one read for the whole queue.
 *
 * Deliberately not one read per gate: the four gates are four stages of one
 * board, so four fetches would be four chances to disagree about the same
 * snapshot. One read is also what keeps this inside the "no new endpoint" rule —
 * `listNotifications` is the read the inbox already ships.
 */
function useLedgerEvents(rpc: ReviewQueueRpc): Ledger {
  const [events, setEvents] = useState<ReviewQueueEvent[]>([]);
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void rpc
      .call("listNotifications", { includeArchived: false })
      .then((result) => {
        if (cancelled) return;
        setEvents(result?.notifications ?? []);
        setOk(true);
      })
      .catch(() => {
        // A failed read leaves the previous snapshot in place and marks itself
        // failed; the last known events are still the last thing we know.
        if (!cancelled) setOk(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, attempt]);
  return { events, ok, loading, retry };
}

function useTick(): number {
  const [nowMs, setNowMs] = useState(clockNow);
  useEffect(() => {
    const timer = setInterval(() => setNowMs(clockNow()), REVIEW_QUEUE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return nowMs;
}

/**
 * `q`, outside a text field.
 *
 * A document-level listening key, which this repo has been burned by — but the
 * ten surfaces that already own one are Escape handlers, and an Escape handler
 * added here would fight the filter bar's. The guard is the point: a key that
 * fires while a reader is typing a card prompt is a key that eats a letter.
 */
function useQueueShortcut(toggle: () => void): void {
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

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return element.isContentEditable === true;
}

function clockNow(): number {
  return typeof Date === "undefined" ? 0 : Date.now();
}

function readOpenFlag(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.reviewQueue) === "true";
  } catch {
    // Inaccessible storage is not a reason to lose the surface: start shut.
    return false;
  }
}

function writeOpenFlag(open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.reviewQueue, open ? "true" : "false");
  } catch {
    // Persistence is a convenience; a blocked write keeps the surface working.
  }
}
