import { useCallback, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { usePanelData } from "../panel/panel-state-hooks";
import { goToInboxCard } from "./inbox-panel-actions";
import {
  INBOX_EVENT_LABELS,
  inboxEventPresentation,
  inboxEventText,
  inboxEventTime,
} from "../../lib/inbox-event-presentation.mjs";
import { inboxAction, inboxPanelState, inboxVisibleEntries } from "../../lib/inbox-panel-state.mjs";

export type InboxNotification = {
  id: string;
  cardId: string;
  cardName: string;
  projectName: string;
  cardKind: "build" | "research" | "explore";
  kind: "question" | "error" | "paused" | "completed";
  summary: string;
  occurredAt: number;
  readAt: number | null;
  resolvedAt: number | null;
  archivedAt: number | null;
  severity: number;
  severityReasons: string[];
};

const INBOX_COPY: Record<InboxNotification["kind"], { icon: string; label: string; tone: string }> = {
  question: { icon: "?", label: INBOX_EVENT_LABELS.question, tone: "bg-amber-500/15 text-amber-700" },
  error: { icon: "!", label: INBOX_EVENT_LABELS.error, tone: "bg-destructive/15 text-destructive" },
  paused: { icon: "Ⅱ", label: INBOX_EVENT_LABELS.paused, tone: "bg-amber-500/15 text-amber-700" },
  completed: { icon: "✓", label: INBOX_EVENT_LABELS.completed, tone: "bg-emerald-500/15 text-emerald-700" },
};

const FILTERS: Array<{ id: InboxFilter; label: string; description: string }> = [
  { id: "attention", label: "Needs attention", description: "Work that needs your decision or recovery." },
  {
    id: "resolved",
    label: "Resolved automatically",
    description: "These needed you once, then cleared on their own — each says how "
      + "(answered, resumed, completed…). History is kept here.",
  },
  { id: "archived", label: "Archived", description: "Archived updates. Restore an item to return it to history." },
  { id: "all", label: "All", description: "All active Inbox updates, newest first." },
];

const FILTER_DOT: Record<InboxFilter, string> = {
  attention: "bg-amber-500",
  resolved: "bg-emerald-500",
  archived: "bg-zinc-500",
  all: "bg-primary",
};
const FILTER_ACTIVE: Record<InboxFilter, string> = {
  attention: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  archived: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  all: "bg-primary/15 text-primary",
};

type InboxFilter = "attention" | "resolved" | "archived" | "all";

function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-md border bg-muted/30" />
      ))}
    </div>
  );
}

function InboxEntry({
  entry,
  onOpen,
  onArchive,
  onRestore,
}: {
  entry: InboxNotification;
  onOpen: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const copy = INBOX_COPY[entry.kind];
  const presentation = inboxEventPresentation(entry);
  const action = inboxAction(entry);
  return (
    <div className={`flex items-start gap-2 p-3 sm:gap-3 ${entry.readAt ? "bg-background" : "bg-amber-500/5"}`}>
      <button
        onClick={onOpen}
        className={
          "flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-sm text-left "
          + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        }
      >
        <span
          aria-hidden
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${presentation.tone ?? copy.tone}`}
        >
          {copy.icon}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2">
            <strong className="text-sm">{entry.cardName}</strong>
            {presentation.stateLabel ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {presentation.label}
              </span>
            ) : null}
            {entry.severity >= 2 && entry.resolvedAt == null ? (
              <span
                className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
                title={entry.severityReasons.join(" · ")}
              >
                escalating
              </span>
            ) : null}
            {!entry.readAt ? (
              <span className="size-1.5 rounded-full bg-primary">
                <span className="sr-only">Unread</span>
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{inboxEventText(entry)}</span>
          {entry.severityReasons.length > 0 && entry.resolvedAt == null ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              {entry.severityReasons.slice(0, 3).join(" · ")}
            </span>
          ) : null}
          <span className="mt-1 block text-xs text-muted-foreground" title={new Date(presentation.stateAt).toLocaleString()}>
            {entry.projectName} · {inboxEventTime(entry)}
          </span>
        </span>
      </button>
      <button
        onClick={action === "restore" ? onRestore : onArchive}
        className={
          "cursor-pointer min-h-11 shrink-0 rounded-md px-3 text-xs font-medium text-muted-foreground "
          + "hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        }
      >
        {action === "restore" ? "Restore" : "Archive"}
      </button>
    </div>
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
  const selected = FILTERS.find((entry) => entry.id === filter)!;
  const panelState = inboxPanelState(firstLoad, loadError, notifications);
  const emptyTitle = unreadOnly
    ? "No unread updates"
    : filter === "attention"
      ? "All clear"
      : `No ${selected.label.toLowerCase()} updates`;
  const emptyDescription = unreadOnly
    ? "Everything in this view has been read."
    : filter === "attention"
      ? "Stelow will surface work only when it needs you."
      : selected.description;

  const open = async (entry: InboxNotification) => {
    if (!entry.readAt) {
      try {
        await rpc.call("markNotificationRead", { notificationId: entry.id });
      } catch {
        // Navigation remains available when acknowledgement fails.
      }
    }
    goToInboxCard(navigate, entry.cardId, entry.id);
  };
  const archive = async (entry: InboxNotification) => {
    await rpc.call("archiveNotification", { notificationId: entry.id });
    await load();
  };
  const restore = async (entry: InboxNotification) => {
    await rpc.call("restoreNotification", { notificationId: entry.id });
    await load();
  };

  return (
    <div className="h-full overflow-auto bg-background p-4 md:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selected.description}{loading && !firstLoad ? " Updating…" : ""}
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
        </div>
        {panelState === "loading" ? <PanelSkeleton /> : panelState === "failure" ? (
          <section className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p>{loadError}</p>
            <button onClick={() => void load()} className="mt-3 min-h-11 cursor-pointer rounded-md border px-3 text-sm font-medium hover:bg-background">
              Retry
            </button>
          </section>
        ) : entries.length ? (
          <section className="space-y-2" aria-label={selected.label}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{selected.label}</h2>
            <div className="divide-y rounded-md border">
              {entries.map((entry) => (
                <InboxEntry
                  key={entry.id}
                  entry={entry}
                  onOpen={() => void open(entry)}
                  onArchive={() => void archive(entry)}
                  onRestore={() => void restore(entry)}
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
