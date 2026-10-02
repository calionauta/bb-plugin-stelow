import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";

export type CardActivity = "idle" | "running" | "awaiting-answer" | "error" | string;

type BuildCardState = {
  stage: string;
  status: string;
  intent: string;
  activity: CardActivity;
  workerThreadId?: string | null;
  /** When the host stopped answering this card's state read (see
   * lib/host-read-streak.mjs). Null whenever the host is answering. */
  readMissSince?: number | null;
};

export function Pill({ children, tone = "bg-muted text-muted-foreground", className = "", title, icon }: { children: ReactNode; tone?: string; className?: string; title?: string; icon?: ReactNode }) {
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone} ${className}`}>{icon ? <span aria-hidden className="inline-flex">{icon}</span> : null}{children}</span>;
}

// The live checkpoint treatment, shared by the timeline cursor and the
// Workflow progress header: one pulsing shape for "where this card is".
export const CURRENT_STAGE_PILL_CLASS = "bg-primary/15 text-primary ring-2 ring-primary/60 stelow-stage-pulse";

export function CurrentStagePill({ stage }: { stage: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${CURRENT_STAGE_PILL_CLASS}`} title="Current workflow checkpoint.">
    <span aria-hidden>●</span>
    {stageLabel(stage)}
  </span>;
}

// One representative glyph per chip kind, so a stage never reads as a type
// and a type never reads as a stage — on Kanban tiles and open cards alike.
const STAGE_ICON: IconName = "Layers";
const INTENT_ICON: Record<string, IconName> = {
  "new-product": "Rocket",
  feature: "Puzzle",
  bugfix: "Bug",
  refactor: "Code",
  investigate: "Search",
  unknown: "CircleDashed",
};

// Lightweight tracks reuse the track-tab glyphs (convention over
// configuration): the state chip carries the track, the content chip the
// playbook piece. One map, both tracks, every surface.
const TRACK_ICON: Record<string, IconName> = { research: "Idea", explore: "Target" };
const TAG_ICON: Record<string, IconName> = { research: "Puzzle", explore: "Beaker" };

// Research/Explore state in one place: board position plus the playbook tag.
// Tiles show identity only (tag) — the board section already gives position —
// while open cards add the position pill, which the board cannot show them.
// Tones match Build by construction: state uses statusTone, the tag stays
// muted, activity keeps its shared vocabulary.
export function LightweightStatusPills({ card, statusTone, columnLabel, tagLabel, tagTitle, kind }: {
  card: { status: string };
  statusTone: (status: string) => string;
  columnLabel: string | null;
  tagLabel: string | null;
  tagTitle: string;
  kind: "research" | "explore";
}) {
  const kindLabel = kind === "research" ? "Research" : "Explore";
  return <>
    {columnLabel ? <Pill tone={statusTone(card.status)} title={`${kindLabel} status — this card's current board state.`} icon={<Icon name={TRACK_ICON[kind] ?? "CircleDashed"} className="size-3" aria-hidden />}>{columnLabel}</Pill> : null}
    {tagLabel ? <Pill title={tagTitle} icon={<Icon name={TAG_ICON[kind] ?? "CircleDashed"} className="size-3" aria-hidden />}>{tagLabel}</Pill> : null}
  </>;
}

const ACTIVITY_PILL_CLASS: Record<string, string> = {
  running: "stelow-activity-working",
  "awaiting-answer": "stelow-activity-waiting",
  error: "stelow-activity-error",
  held: "stelow-activity-onhold",
};
const ACTIVITY_GLYPH: Record<string, string> = {
  running: "●",
  "awaiting-answer": "⏳",
  error: "✗",
  held: "⏸",
};
const ACTIVITY_LABEL: Record<string, string> = {
  idle: "Paused",
  running: "Working",
  "awaiting-answer": "Waiting for you",
  error: "Failed",
  held: "Waiting on the host",
};
const ACTIVITY_TITLE: Record<string, string> = {
  running: "Worker is actively working",
  "awaiting-answer": "Waiting for your answer",
  error: "Worker failed. Needs attention.",
  held: "The host has this card's next message queued and has not dispatched it yet. "
    + "The card continues on its own — nothing to do.",
};

// The review request, not a workflow position. Three decisions are load
// bearing here, and none of them is the styling:
//
// - NO DOT. A dot is this vocabulary's "here is a position" tell — the stage
//   pill, the activity pill and the attention chip all carry one — and on a
//   terminal card the stage pill is deliberately suppressed (see
//   BuildStatusPills), so a dot left the chip sitting in the vacated slot and
//   reading as the card's next checkpoint instead of a request about work
//   that is already finished.
// - NOT the bare word "Review". `review` is a phase id in the stage catalog
//   and BUILD_BOARD_COLUMN_LABELS spreads PHASE_LABELS, so the board already has
//   a column header for that phase — currently labelled "Evaluation". A chip
//   wearing the bare id is a position that does not exist.
// - ONE component for the tile and the list row. The board tile used to carry
//   a private copy of this chip, a dot and a type size away from the list
//   row, which is exactly the drift the shared-vocabulary rule exists to
//   prevent and the one rule no test could see.
//
// `label` exists so a surface that has a more specific sentence can supply it,
// but the default is the one name this request gets: "Ready for review" is
// already what the Inbox calls the same row (FEATURES.md, Recover), and a
// request with two names is one the reader has to reconcile.
export function ReviewChip({ label = "Ready for review" }: { label?: string }) {
  const cls = "rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300";
  return <span title="Open this card to clear it." className={cls}>{label}</span>;
}

export function attentionLabel(activity: string): string {
  if (activity === "awaiting-answer") return "Answer required";
  if (activity === "error") return "Worker failed";
  return "Paused. Resume it.";
}

// One component owns the transient activity vocabulary everywhere it appears.
// Build summaries choose only the human-waiting state; active work is a live
// border, while lightweight cards can opt into their compact activity pill.
export function ActivityPill({ activity, detail }: { activity: CardActivity; detail?: string | null }) {
  const cls = ACTIVITY_PILL_CLASS[activity];
  if (!cls) return null;
  const title = activity === "error" && detail ? `Worker failed: ${detail}` : ACTIVITY_TITLE[activity];
  return <span className={`stelow-activity-pill max-w-full truncate ${cls}`} title={title}>
    <span aria-hidden>{ACTIVITY_GLYPH[activity]}</span>
    {ACTIVITY_LABEL[activity] ?? activity}
  </span>;
}

/**
 * The host has stopped answering this card's state read.
 *
 * It borrows the activity pill's shape and nothing else, on purpose: it is a
 * property of the READ, so it renders beside the activity rather than as one —
 * the card is still showing the activity it was last verified on, and erasing
 * that to make room for this would destroy the only true thing the tile says.
 *
 * Deliberately inert, for the reason `stelow-activity-onhold` is: nothing the
 * reader can do changes this, and a state you cannot act on must not wear the
 * colours of one you should. What it must not be is invisible — a card frozen
 * on a stale projection used to look like a normally idle card, which is how
 * three unreadable cards on 2026-09-30 were explained by theory instead of by
 * a measurement. The card's hero carries the sentence; this carries the name.
 */
const READ_MISS_TITLE = "The host has not answered this card's state read. "
  + "What this tile shows is its last verified projection, so it is stale. "
  + "The plugin log names the card once per outage, and the next successful read clears this — nothing to do.";

export function ReadMissPill() {
  return (
    <span
      className="stelow-activity-pill stelow-activity-unreadable max-w-full truncate"
      title={READ_MISS_TITLE}
    >
      <span aria-hidden>⏱</span>
      Host not answering
    </span>
  );
}

// One attention chip for tiles and list rows alike: amber dot + action
// label ("Answer required", "Worker failed", "Paused. Resume it."). Callers
// show it only when the activity pill doesn't already say it — the pair
// must never read as the same state twice.
export function AttentionChip({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
    <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
    <span>{label}</span>
  </span>;
}

/**
 * A card whose worker ran out of work and is waiting for the user.
 *
 * Amber, like the attention chip it appears alongside — this is a "needs
 * you" state, not a failure. It is a separate component rather than a branch
 * inside the attention chip because the two say different things: attention
 * means a specific known thing is outstanding, pause means the worker simply
 * stopped producing and the user has to decide what to do about it.
 */
export function PausedChip({ label, detail }: { label: string; detail: string }) {
  return (
    <span
      title={detail}
      className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-zinc-500" />
      <span>{label}</span>
    </span>
  );
}

/**
 * A card that has stopped.
 *
 * Red, and it does not pulse: the card's own border already pulses to say
 * something is wrong, and a pulsing chip on a pulsing card reads as one
 * alarm rather than two. This is the label the border could not carry —
 * `card_e3u00eb4` was outlined in amber like a card waiting for an answer,
 * and nothing on the card said otherwise.
 */
export function ErrorChip({ label, detail }: { label: string; detail: string }) {
  return (
    <span
      title={detail}
      className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
      <span>{label}</span>
    </span>
  );
}

/**
 * What a finished card still owes its repository.
 *
 * Amber is the same tone as AttentionChip on purpose: both mean "this card
 * wants a person", and a reader who learns one tone should not have to learn
 * a second for the same call to action. The difference is in the text, not
 * the color — the label names the missing step.
 */
export function IntegrationPendingChip({ label, detail }: { label: string; detail: string }) {
  return (
    <span
      title={detail}
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
      <span>{label}</span>
    </span>
  );
}

// Dot tone for hill dots. List rows keep their own inline mapping on
// purpose: there, emerald is reserved for pending review (a completed
// card without review reads muted), while on the hill every completed
// card reads emerald — position already says where it is, color says
// what kind of state it is in. Do not "unify" the two without re-deciding
// that product distinction.
export function activityDotTone(card: { needsAttention?: boolean | null; activity?: string | null; status?: string | null }): string {
  if (card.needsAttention) return "bg-amber-500";
  if (card.activity === "error") return "bg-destructive";
  if (card.activity === "running") return "bg-primary";
  if (card.status === "completed") return "bg-emerald-500";
  return "bg-muted-foreground/40";
}

// Doing-now pill: the executing scope (or task) name on closed surfaces,
// truncated to fit with the full list one hover away. Empty renders
// nothing — a card with nothing running shows no pill, never a placeholder.
export function DoingNowPill({ names }: { names: string[] }) {
  if (!Array.isArray(names) || names.length === 0) return null;
  const [first, ...rest] = names;
  return (
    <span title={rest.length > 0 ? `Doing now: ${names.join(" · ")}` : `Doing now: ${first}`} className="inline-flex min-w-0 max-w-full cursor-default items-center gap-1 truncate rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
      <span className="truncate">{first}{rest.length > 0 ? ` +${rest.length}` : ""}</span>
    </span>
  );
}

// One scope strip for tiles and list rows alike: aggregate fill from the
// summary counts, so progress reads as shape, not just numbers. Null when
// the card has no scopes — tracks without scope data show nothing rather
// than an empty bar.
type ScopeProgressItem = { status?: string };

function scopeSegmentTone(status: string | undefined, index: number, done: number): string {
  if (status === "completed" || status === "done" || (status == null && index < done)) return "bg-emerald-500";
  if (status === "in-progress" || status === "running") return "bg-primary";
  if (status === "blocked" || status === "failed" || status === "escalated") return "bg-amber-500";
  return "bg-muted";
}

export function ScopeProgressTrack({ items, done, total, className = "", label = "Scope progress" }: { items?: ScopeProgressItem[]; done: number; total: number; className?: string; label?: string }) {
  if (!(total > 0)) return null;
  const pct = Math.max(0, Math.min(100, (done / total) * 100));
  if (!items || total > 12) return <div role="progressbar" aria-label={`${label}: ${done} of ${total} complete`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} className={`h-1.5 min-w-0 overflow-hidden rounded-full bg-muted/70 ${className}`}><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>;
  const segments = Array.from({ length: total }, (_, index) => items?.[index] ?? { status: index < done ? "completed" : "pending" });
  return <div role="progressbar" aria-label={`${label}: ${done} of ${total} complete`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} className={`flex h-1.5 min-w-0 gap-0.5 overflow-hidden rounded-full bg-muted/70 ${className}`}>
    {segments.map((segment, index) => <span key={index} className={`min-w-0 flex-1 first:rounded-l-full last:rounded-r-full ${scopeSegmentTone(segment.status, index, done)}`} />)}
  </div>;
}

export function ScopeStrip({ done, total }: { done: number; total: number }) {
  return <ScopeProgressTrack done={done} total={total} className="w-16 shrink-0" label="Scopes" />;
}

// The same summary is used by a Build tile and its open-card breadcrumb:
// workflow checkpoint, workflow type, then (only when needed) human input.
// Column/status and "working" are deliberately excluded: they are board
// placement and live-border signals, not the card's identity. A parked Inbox
// card names no checkpoint it never reached: without a worker it reads
// Not started, matching the hero's parked copy.
export function BuildStatusPills({ card, statusTone, intentLabel }: {
  card: BuildCardState;
  statusTone: (status: string) => string;
  intentLabel: (intent: string) => string | undefined;
}) {
  const started = card.workerThreadId !== null && card.workerThreadId !== undefined;
  // Terminal cards traversed every checkpoint by definition: the stage pill
  // would name a position the card no longer occupies, so completed and
  // archived cards keep identity (intent) without it. Blocked keeps its
  // stage — that work resumes where it stopped.
  const terminal = card.status === "completed" || card.status === "archived";
  return <>
    {!terminal ? (started
      ? <Pill tone={statusTone(card.status)} title="Workflow stage — the specific checkpoint this card is at." icon={<Icon name={STAGE_ICON} className="size-3" aria-hidden />}>{card.stage ? stageLabel(card.stage) : "Not started"}</Pill>
      : <Pill title="Not started — parked in Bucket. Nothing runs until you start it.">Not started</Pill>) : null}
    {card.intent !== "unknown" ? <Pill title="Workflow type chosen during triage." icon={<Icon name={INTENT_ICON[card.intent] ?? "CircleDashed"} className="size-3" aria-hidden />}>{intentLabel(card.intent) ?? card.intent}</Pill> : null}
    {/* The three states a reader must be able to tell apart from across the
        board without opening anything: someone is waiting on THEM, the host is
        holding the card and it will move by itself, or the card's own state has
        stopped being readable and what the tile shows is now stale. Everything
        else stays on the card. */}
    {card.activity === "awaiting-answer" || card.activity === "held"
      ? <ActivityPill activity={card.activity} />
      : null}
    {card.readMissSince != null ? <ReadMissPill /> : null}
  </>;
}
