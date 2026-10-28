import { useCallback, useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { usePanelData } from "../panel/panel-state-hooks";
import { HolderChip } from "./inbox-holder-chip";
import { openAskDoor } from "./inbox-ask-door";
import { InboxEntry } from "./inbox-row";
import { useStableInboxOrder } from "./use-stable-inbox-order";
import { Button } from "../ui/button";
import { goToHolderCard, goToInboxCard } from "./inbox-panel-actions";
import { inboxPanelState, inboxVisibleEntries } from "../../lib/inbox-panel-state.mjs";

import type { InboxNotification } from "./inbox-types";

export type { InboxNotification };

const FILTERS: Array<{ id: InboxFilter; label: string; description: string }> = [
  { id: "attention", label: "Needs attention", description: "Work that needs your decision or recovery." },
  {
    id: "resolved",
    label: "Resolved automatically",
    description: "These needed you once, then cleared on their own — each says how "
      + "(answered, resumed, completed…). History is kept here.",
  },
  {
    id: "read",
    label: "Read",
    description: "Updates you have already seen. Mark one unread to bring it back to attention.",
  },
  {
    id: "archived",
    label: "Set aside",
    description: "Updates you dismissed. The cards were not affected — bring any back.",
  },
  { id: "all", label: "All", description: "All active Inbox updates, newest first." },
];

const FILTER_DOT: Record<InboxFilter, string> = {
  attention: "bg-amber-500",
  resolved: "bg-emerald-500",
  read: "bg-zinc-500",
  archived: "bg-stone-400",
  all: "bg-primary",
};
const FILTER_ACTIVE: Record<InboxFilter, string> = {
  attention: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  read: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  archived: "bg-stone-500/15 text-stone-600 dark:text-stone-300",
  all: "bg-primary/15 text-primary",
};

type InboxFilter = "attention" | "resolved" | "read" | "archived" | "all";

/**
 * The filter tabs plus the Unread-only toggle: what the reader is looking at.
 * Split out because it is the view concern, while the panel owns loading,
 * empty states, and the list itself.
 */
function InboxToolbar({ filter, setFilter, unreadOnly, setUnreadOnly }: {
  filter: InboxFilter;
  setFilter: (filter: InboxFilter) => void;
  unreadOnly: boolean;
  setUnreadOnly: (unreadOnly: boolean) => void;
}) {
  return (
    <>
      <div className="flex min-h-11 gap-1 overflow-x-auto rounded-md border p-1" aria-label="Inbox filters">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setFilter(entry.id)}
            aria-pressed={filter === entry.id}
            title={entry.description}
            className={[
              "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded px-3 text-sm font-medium",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
              filter === entry.id ? FILTER_ACTIVE[entry.id] : "text-muted-foreground hover:bg-muted",
            ].join(" ")}
          >
            <span aria-hidden className={`size-1.5 rounded-full ${FILTER_DOT[entry.id]}`} />
            {entry.label}
          </button>
        ))}
      </div>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} className="size-4 accent-primary" />
        Unread only
      </label>
    </>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-md border bg-muted/30" />
      ))}
    </div>
  );
}

/**
 * A row's first line: which card, what state, and the two markers that must
 * read at a glance without the reader parsing the sentence below them.
 *
 * Extracted because the row is a list item, not a paragraph: the header is one
 * concern — identity and state — and keeping it apart is what lets the row stay
 * about the event itself.
 */
/**
 * Open a notification: acknowledge it, then go there.
 *
 * Acknowledgement is best-effort on purpose. A reader who clicked a card to
 * act on it must still arrive even if marking it read fails, so the error is
 * swallowed here and the navigation is not. That is the one place in this file
 * where a failure is deliberately not reported, and the comment says so rather
 * than leaving a reader to wonder.
 */
function openNotification(
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>,
  navigate: ReturnType<typeof useBbNavigate>,
  _reload: () => Promise<unknown>,
) {
  return async (entry: InboxNotification) => {
    if (!entry.readAt) {
      try {
        await rpc.call("markNotificationRead", { notificationId: entry.id });
      } catch {
        // Navigation remains available when acknowledgement fails.
      }
    }
    goToInboxCard(navigate, entry.cardId, entry.id);
  };
}

// The two read transitions, as one pair.
//
// "Mark as read" is the read timestamp, not the archive one. Setting a
// notification aside exists and stays available in Manage for the rare case of
// clearing history, but a button on the item itself must be the reversible one:
// archive is a card-shaped word, and the one-way decision has no business on
// the reversible act.
function readToggles(
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>,
  load: () => Promise<unknown>,
) {
  const call = (method: "markNotificationRead" | "markNotificationUnread" | "archiveNotification" | "restoreNotification") =>
    async (entry: InboxNotification) => {
      await rpc.call(method, { notificationId: entry.id });
      await load();
    };
  return {
    markRead: call("markNotificationRead"),
    markUnread: call("markNotificationUnread"),
    setAside: call("archiveNotification"),
    bringBack: call("restoreNotification"),
  };
}

/** The chip, bound to the router. The only thing the panel owns is where it goes. */
function holderChipFor(navigate: ReturnType<typeof useBbNavigate>) {
  return (entry: InboxNotification): ReactNode => (
    <HolderChip entry={entry} onOpen={() => goToHolderCard(navigate, entry.holderCardId!)} />
  );
}

export function InboxPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [filter, setFilter] = useState<InboxFilter>("attention");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const loadInbox = useCallback(async () => ({
    notifications: (await rpc.call("listNotifications", { includeArchived: true })).notifications,
  }), [rpc]);
  const {
    data: { notifications },
    isInitialLoad: firstLoad,
    load,
    loadError,
    loading,
  } = usePanelData(loadInbox, {
    errorMessage: "Unable to load Stelow Inbox.",
    notifyOnError: false,
    initialData: { notifications: [] as InboxNotification[] },
    itemCountKey: "notifications",
    realtimeChannels: ["card-state", "inbox-changed"],
  });
  const entries = inboxVisibleEntries(notifications, filter, unreadOnly);
  // The order is held while the reader is looking: a row that gains severity
  // keeps its place instead of moving under a click meant for the row below it.
  const { shown, held, show } = useStableInboxOrder(entries, `${filter}:${unreadOnly}`);
  const selected = FILTERS.find((entry) => entry.id === filter)!;
  const panelState = inboxPanelState(firstLoad, loadError, notifications);
  const emptyTitle = unreadOnly
    ? "No unread updates"
    : filter === "attention"
      ? "All clear"
      : filter === "archived"
        ? "Nothing set aside"
        : `No ${selected.label.toLowerCase()} updates`;
  const emptyDescription = unreadOnly
    ? "Everything in this view has been read."
    : filter === "attention"
      ? "Stelow will surface work only when it needs you."
      : selected.description;

  const open = openNotification(rpc, navigate, load);
  const { markRead, markUnread, setAside, bringBack } = readToggles(rpc, load);
  const openAsk = openAskDoor(rpc, navigate, load);

  return (
    <div className="h-full overflow-auto bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selected.description}{loading && !firstLoad ? " Updating…" : ""}
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <InboxToolbar filter={filter} setFilter={setFilter} unreadOnly={unreadOnly} setUnreadOnly={setUnreadOnly} />
          {held > 0 ? (
            <Button variant="outline" className="min-h-11" onClick={show}>
              {held === 1 ? "1 update" : `${held} updates`} · Show
            </Button>
          ) : null}
        </div>
        {panelState === "loading" ? <PanelSkeleton /> : panelState === "failure" ? (
          <section className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p>{loadError}</p>
            <button onClick={() => void load()} className="mt-3 min-h-11 cursor-pointer rounded-md border px-3 text-sm font-medium hover:bg-background">
              Retry
            </button>
          </section>
        ) : shown.length ? (
          <section className="space-y-2" aria-label={selected.label}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{selected.label}</h2>
            <div className="divide-y rounded-md border">
              {shown.map((entry) => (
                <InboxEntry
                  key={entry.id}
                  entry={entry}
                  onOpen={() => void open(entry)}
                  onOpenAsk={openAsk}
                  onHolderChip={holderChipFor(navigate)}
                  onMarkRead={() => void markRead(entry)}
                  onMarkUnread={() => void markUnread(entry)}
                  onSetAside={() => void setAside(entry)}
                  onBringBack={() => void bringBack(entry)}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="rounded-md border border-dashed bg-muted/30 p-8 text-center">
            <h2 className="text-sm font-semibold">{emptyTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
          </section>
        )}
      </div>
    </div>
  );
}
