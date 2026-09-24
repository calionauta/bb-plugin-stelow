import { archivedCardDetailPresentation } from "../../lib/card-detail-presentation.mjs";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";

// Detail hero: one status reading per card — decision, error, paused,
// working, or calm — plus the hero chrome (style map, error note) the
// three detail bodies render around it. Priority order is the contract:
// archived first, then open questions, then failure, then lifecycle.

export type HeroKind = "decision" | "error" | "paused" | "working" | "calm";

export type HeroCardState = {
  activity: string;
  status: string;
  stage: string;
  workerThreadId: string | null;
  lastError: string | null;
};

export type HeroDetailState = {
  pendingQuestions: Array<unknown>;
  expiredQuestions: Array<unknown>;
  card: { needsAttention: boolean; stallCount: number };
} | null;

export function heroFor(card: HeroCardState, detail: HeroDetailState): { kind: HeroKind; title: string; sub: string } {
  return attentionHero(card, detail) ?? workerHero(card, detail) ?? calmHero(card);
}

// Needs-a-human states first: archived history, then open questions. An
// open question always wins — answering resumes the worker on its own.
function attentionHero(card: HeroCardState, detail: HeroDetailState): { kind: HeroKind; title: string; sub: string } | null {
  const archived = archivedCardDetailPresentation(card, stageLabel);
  if (archived) return archived.hero;
  const pending = (detail?.pendingQuestions?.length ?? 0) + (detail?.expiredQuestions?.length ?? 0);
  if (pending === 0) return null;
  return {
    kind: "decision",
    title: pending === 1 ? "Needs your decision to continue" : `Needs your decision — ${pending} questions`,
    sub: "Answer below and the agent resumes on its own.",
  };
}

// Worker states in priority order: preparing, failed, finished, stuck,
// running. A completed card is done being worked — say so plainly, before
// any idle-based branch can misfire on it. "At Audit" on a finished card
// read as "the agent is auditing" or "waiting for me", when neither is
// true: the outcome below is ready to review. (includes() like statusTone
// below: the contract narrows this union upstream of here.)
function workerHero(card: HeroCardState, detail: HeroDetailState): { kind: HeroKind; title: string; sub: string } | null {
  if (card.activity === "awaiting-answer") {
    return {
      kind: "working",
      title: `Waiting — ${stageLabel(card.stage)}`,
      sub: "The agent is preparing a question. Nothing needs you yet.",
    };
  }
  if (card.activity === "error") {
    return {
      kind: "error",
      title: "The worker stopped",
      sub: card.lastError ?? "Something went wrong. Retry continues in place; restart begins fresh.",
    };
  }
  if (["completed", "done"].includes(card.status)) {
    return {
      kind: "calm",
      title: "Done — ready to review",
      sub: "The workflow passed its final audit verification. The result is below.",
    };
  }
  // Prominent paused state only when the idle is known-stuck (past the grace
  // period), never for the routine seconds-long idle between agent turns.
  // Firing it on every turn would cry wolf and teach the signal to be ignored.
  // Fresh idles still get the subtle resume row in the calm hero below.
  if (card.activity === "idle" && card.workerThreadId != null && detail?.card.needsAttention) {
    const stalls = detail?.card.stallCount ?? 0;
    return {
      kind: "paused",
      title: "Paused",
      sub: stalls >= 3
        ? `Stalled ${stalls} times in ${stageLabel(card.stage)} with no progress — inspect the thread before retrying, or restart fresh.`
        : card.lastError
          ? "The worker failed with unfinished work. Retry continues in place; restart begins fresh from triage."
          : "The worker is idle with unfinished work. Resume continues in place; restart begins fresh from triage.",
    };
  }
  if (card.activity === "running") {
    return {
      kind: "working",
      title: `Working — ${stageLabel(card.stage)}`,
      sub: "The agent advances on its own. Nothing needs you right now.",
    };
  }
  return null;
}

// Rest states: parked with no worker, or a calm default that names the
// checkpoint without claiming anything needs doing.
function calmHero(card: HeroCardState): { kind: HeroKind; title: string; sub: string } {
  // A completed research index is represented by the Done column, not a
  // separate review state. Keep the hero calm and let the board carry status.
  // A parked card names no checkpoint either: without a worker nothing has
  // started, whatever the seeded stage says.
  if (card.workerThreadId == null) {
    return {
      kind: "calm",
      title: "Not started",
      sub: "Parked in Inbox. Nothing runs until you start it.",
    };
  }
  return {
    kind: "calm",
    title: `At ${stageLabel(card.stage)} — nothing needs you`,
    sub: "Follow along below, or send a note to the agent.",
  };
}

export const HERO_STYLE: Record<HeroKind, { wrap: string; dot: string; alert: boolean }> = {
  decision: { wrap: "border-amber-500/50 bg-amber-500/5", dot: "bg-amber-500", alert: true },
  error: { wrap: "border-destructive/40 bg-destructive/5", dot: "bg-destructive", alert: true },
  paused: { wrap: "border-amber-500/40 bg-amber-500/5", dot: "bg-amber-500", alert: false },
  working: { wrap: "border-emerald-500/30 bg-emerald-500/5", dot: "bg-emerald-500", alert: false },
  calm: { wrap: "border-border bg-card", dot: "bg-muted-foreground", alert: false },
};

// A decision hero wins over the error hero by design — the open question is
// the recovery path — so a concurrent failure must be named inside it.
// Otherwise the Failed chip reads as unexplained next to an actionable
// question. Shared by all three track detail bodies.
export function HeroErrorNote({ card }: { card: { activity: string; lastError: string | null } }) {
  if (card.activity !== "error" || !card.lastError) return null;
  return (
    <p className="w-full rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs leading-5 text-destructive" title={card.lastError}>
      <span className="font-semibold">Last worker error:</span> {card.lastError} Answering below resumes the worker.
    </p>
  );
}
