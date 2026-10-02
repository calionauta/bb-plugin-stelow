import { formatDuration } from "../../lib/card-metrics.mjs";

/**
 * The two flow readings that are about a card's time rather than its column:
 * where the finished cards' wall-clock went, and which cards are waiting on a
 * person right now.
 *
 * Split out of `flow-strip.tsx` when the strip crossed its file budget. The cut
 * is by subject — the strip owns the header, the tabs and the per-card table;
 * these are the two blocks the tabs render — not by line count, because a file
 * split to hit a number is a file that regrows the moment nobody is looking.
 */

/** The parts, in the order they read: the person, the machine, the unexplained. */
const WAIT_PARTS = [
  { key: "human", label: "waiting on you", tone: "bg-sky-500" },
  { key: "system", label: "worker or system", tone: "bg-amber-500" },
  { key: "unattributed", label: "unattributed", tone: "bg-muted-foreground/40" },
] as const;

export type WaitTotals = {
  totalMs: number;
  humanMs: number;
  systemMs: number;
  unattributedMs: number;
};

/**
 * Where the finished cards' time actually went.
 *
 * Named "wait", never "attention": the Attention tab already means "cards that
 * need you right now", and this repo treats one word with two meanings as a
 * defect. The three parts are disjoint and sum to the whole, and the last is
 * `unattributed` — time the data does not explain. Naming it "working" would be
 * the exact claim `lib/wait-attribution.mjs` refuses to make.
 */
export function WaitBreakdown({ wait }: { wait: WaitTotals }) {
  if (wait.totalMs === 0) return null;
  const amount = (part: (typeof WAIT_PARTS)[number]) => {
    if (part.key === "human") return wait.humanMs;
    if (part.key === "system") return wait.systemMs;
    return wait.unattributedMs;
  };
  return (
    <div className="space-y-1" aria-label="Where the time went">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-foreground">
          Where the time went
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatDuration(wait.totalMs)} total
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {WAIT_PARTS.map((part) => (
          <span
            key={part.key}
            className={part.tone}
            style={{ width: `${(amount(part) / wait.totalMs) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {WAIT_PARTS.map((part) => (
          <li
            key={part.key}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span className={`size-1.5 rounded-full ${part.tone}`} aria-hidden />
            <span className="tabular-nums text-foreground">
              {formatDuration(amount(part))}
            </span>
            {part.label}
          </li>
        ))}
      </ul>
      <p className="text-xs leading-5 text-muted-foreground">
        Waiting on you is time a question held the card. Worker or system is a
        paused worker, a lock wait, or a failure. Unattributed is time no row
        explains — never claimed as work.
      </p>
    </div>
  );
}

export type AttentionEntry = {
  cardId: string;
  kind: "build" | "research" | "explore";
  name: string;
  reason: "stuck" | "review";
  waitMs: number | null;
};

/** One row: the card, how long it has waited, and why it is here. */
export function AttentionRow({
  entry,
  onOpenCard,
}: {
  entry: AttentionEntry;
  onOpenCard: (kind: AttentionEntry["kind"], cardId: string) => void;
}) {
  const tone =
    entry.reason === "stuck"
      ? "text-amber-700 dark:text-amber-300"
      : "text-emerald-700 dark:text-emerald-300";
  return (
    <li>
      <button
        onClick={() => onOpenCard(entry.kind, entry.cardId)}
        className={
          "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs "
          + "hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        }
      >
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {entry.waitMs != null ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            waiting {formatDuration(entry.waitMs)}
          </span>
        ) : null}
        <span className={`shrink-0 font-medium ${tone}`}>
          {entry.reason === "stuck" ? "stuck" : "to review"}
        </span>
      </button>
    </li>
  );
}
