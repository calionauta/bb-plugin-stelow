import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";

export type CardActivity = "idle" | "running" | "awaiting-answer" | "error" | string;

type BuildCardState = {
  stage: string;
  status: string;
  intent: string;
  activity: CardActivity;
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

const ACTIVITY_PILL_CLASS: Record<string, string> = {
  running: "stelow-activity-working",
  "awaiting-answer": "stelow-activity-waiting",
  error: "stelow-activity-error",
};
const ACTIVITY_GLYPH: Record<string, string> = { running: "●", "awaiting-answer": "⏳", error: "✗" };
const ACTIVITY_LABEL: Record<string, string> = { idle: "Paused", running: "Working", "awaiting-answer": "Waiting for you", error: "Failed" };
const ACTIVITY_TITLE: Record<string, string> = { running: "Worker is actively working", "awaiting-answer": "Waiting for your answer", error: "Worker failed. Needs attention." };

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

// The same summary is used by a Build tile and its open-card breadcrumb:
// workflow checkpoint, workflow type, then (only when needed) human input.
// Column/status and "working" are deliberately excluded: they are board
// placement and live-border signals, not the card's identity.
export function BuildStatusPills({ card, statusTone, intentLabel }: {
  card: BuildCardState;
  statusTone: (status: string) => string;
  intentLabel: (intent: string) => string | undefined;
}) {
  return <>
    <Pill tone={statusTone(card.status)} title="Workflow stage — the specific checkpoint this card is at." icon={<Icon name={STAGE_ICON} className="size-3" aria-hidden />}>{card.stage ? stageLabel(card.stage) : "Not started"}</Pill>
    {card.intent !== "unknown" ? <Pill title="Workflow type chosen during triage." icon={<Icon name={INTENT_ICON[card.intent] ?? "CircleDashed"} className="size-3" aria-hidden />}>{intentLabel(card.intent) ?? card.intent}</Pill> : null}
    {card.activity === "awaiting-answer" ? <ActivityPill activity={card.activity} /> : null}
  </>;
}
