import { archivedCardDetailPresentation } from "../../lib/card-detail-presentation.mjs";
import { lockWaitHero } from "../../lib/lock-blocked.mjs";
import { readMissHero } from "../../lib/host-read-streak.mjs";
import { isOwnershipRefusal } from "../../lib/ownership-refusal.mjs";
import { rateLimitAdvice } from "../../lib/rate-limit-refusal.mjs";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";

// Detail hero: one status reading per card — decision, error, paused,
// working, or calm — plus the hero chrome (style map, error note) the
// three detail bodies render around it. Priority order is the contract:
// archived first, then open questions, then failure, then lifecycle.

export type HeroKind = "decision" | "error" | "paused" | "held" | "unreadable" | "working" | "calm";

export type HeroCardState = {
  activity: string;
  status: string;
  stage: string;
  workerThreadId: string | null;
  lastError: string | null;
  /** When the host stopped answering this card's state read, with the
   * measurement's sentence derived from it (lib/host-read-streak.mjs). Null
   * whenever the host is answering. */
  readMissSince?: number | null;
};


export type HeroDetailState = {
  pendingQuestions: Array<unknown>;
  expiredQuestions: Array<unknown>;
  card: { needsAttention: boolean; stallCount: number };
  /** The card's file-claim wait, when another live card holds one of its
   * files. Read only where it decides the hero — see the contention branch in
   * `workerHero`. Same shape the server derives (lib/lock-blocked.mjs). */
  fileLocks?: {
    files: string[];
    holders: string[];
    holderCardId: string;
    holderName: string;
    internal: boolean;
    expiresAt: number;
  } | null;
  /** The host's hold on the card's next dispatch, with its sentence already
   * derived server-side (lib/host-hold.mjs). Null when nothing is held. */
  hostHold?: { summary: string | null } | null;
  /** The native Workflows run that owns the card's stage, with its sentence
   * already derived server-side (lib/native-run.mjs). Null when none is live. */
  nativeRun?: { summary: string | null } | null;
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
  // The host owns the next dispatch, so this is checked before every idle
  // branch. A held card is not stuck and not failed — it is a card whose
  // message is already queued, and the sentence says so in the host's own
  // words rather than offering a recovery for a card that is already on its
  // way. Falls through to the calm hero when the record is unreadable, so a
  // missed read can never invent a state.
  if (card.activity === "held" && detail?.hostHold?.summary) {
    return { kind: "held", title: `Waiting on the host — ${stageLabel(card.stage)}`, sub: detail.hostHold.summary };
  }
  const unreadable = unreadableHero(card);
  if (unreadable) return unreadable;
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
  if (isKnownStall(card, detail)) return stalledHero(card, detail);
  if (card.activity === "running") return workingHero(card, detail);
  return null;
}

/**
 * The card is working — but a card can be working in two places.
 *
 * A thread turn is the ordinary one, and "the agent advances on its own"
 * describes it honestly. A host Workflows run is not: the run is a subprocess
 * that outlives the turn that started it, so the thread sits idle for the
 * whole run and that sentence would describe a turn that is never coming. The
 * run's own words name where the work is and that it needs nothing, which is
 * the only honest reading of a card that looks stalled and is not.
 */
function workingHero(card: HeroCardState, detail: HeroDetailState): { kind: HeroKind; title: string; sub: string } {
  const sub = detail?.nativeRun?.summary ?? "The agent advances on its own. Nothing needs you right now.";
  return { kind: "working", title: `Working — ${stageLabel(card.stage)}`, sub };
}

function isKnownStall(card: HeroCardState, detail: HeroDetailState): boolean {
  return card.activity === "idle" && card.workerThreadId != null && detail?.card.needsAttention === true;
}

/**
 * Why an idle card is idle, and what to do about it.
 *
 * Contention outranks a generic stall: the idle has a KNOWN cause that
 * resolves on its own, and a reader told "the worker is idle with unfinished
 * work" goes looking for a crash that is not there. The contention state is
 * decided in lib/lock-blocked.mjs — the same module, and the same record, the
 * Inbox row derives from — so the card does not write a second version of that
 * sentence.
 */
function stalledHero(card: HeroCardState, detail: HeroDetailState): { kind: HeroKind; title: string; sub: string } {
  const contention = lockWaitHero(detail?.fileLocks ?? null);
  if (contention) return contention;
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

/**
 * The host is not answering this card's state read.
 *
 * Above the failure and the stall branches, for the same reason the hold is
 * above them: a verdict recorded before the reads stopped cannot be
 * re-verified, and offering Retry or Resume for a card nobody can read is an
 * action aimed at nothing. The stage is still named, because the last verified
 * projection is real — it is just no longer fresh, which is what the derived
 * sentence says.
 *
 * The wording lives in lib/host-read-streak.mjs so the card, the test and any
 * future surface cannot say it three slightly different ways; this is the
 * placement, and the placement is the part with a failure mode.
 */
function unreadableHero(card: HeroCardState): { kind: HeroKind; title: string; sub: string } | null {
  return readMissHero(
    card.readMissSince ?? null,
    Date.now(),
    stageLabel(card.stage),
  );
}

export const HERO_STYLE: Record<HeroKind, { wrap: string; dot: string; alert: boolean }> = {
  decision: { wrap: "border-amber-500/50 bg-amber-500/5", dot: "bg-amber-500", alert: true },
  error: { wrap: "border-destructive/40 bg-destructive/5", dot: "bg-destructive", alert: true },
  paused: { wrap: "border-amber-500/40 bg-amber-500/5", dot: "bg-amber-500", alert: false },
  // Held reads between paused and calm on purpose: it is a real wait, so it
  // gets a visible surface, but nothing is wrong, so it borrows calm's neutral
  // border rather than paused's amber. Amber here would ask for a decision the
  // reader cannot make.
  held: { wrap: "border-border bg-muted/40", dot: "bg-muted-foreground", alert: false },
  // Unreadable is neither: something IS wrong, but it is the host and nothing
  // on the card can fix it. It borrows the visible surface `held` earns for the
  // same reason and takes an amber-free slate border instead, because this is a
  // measurement the reader should see rather than a decision they should make.
  unreadable: { wrap: "border-slate-500/40 bg-slate-500/5", dot: "bg-slate-500", alert: false },
  working: { wrap: "border-emerald-500/30 bg-emerald-500/5", dot: "bg-emerald-500", alert: false },
  calm: { wrap: "border-border bg-card", dot: "bg-muted-foreground", alert: false },
};

// A decision hero wins over the error hero by design — the open question is
// the recovery path — so a concurrent failure must be named inside it.
// Otherwise the Failed chip reads as unexplained next to an actionable
// question. Shared by all three track detail bodies.
export function HeroErrorNote({ card }: { card: { activity: string; lastError: string | null } }) {
  if (card.activity !== "error" || !card.lastError) return null;
  // The trailing sentence has to name an action that CLEARS this cause. Two causes do
  // not answer to "answer below": an unowned card (the conversation is refused until
  // the records agree) and a provider rate limit (nothing is pending, and the provider
  // is refusing for hours). Both shipped with the generic advice, and both sent a reader
  // to a box whose answer goes nowhere.
  const rateLimit = rateLimitAdvice(card.lastError);
  const trailing = rateLimit
    ? rateLimit
    : isOwnershipRefusal(card.lastError)
      ? "Restart fresh… in the card actions menu is what clears this; nothing on the card is waiting for an answer."
      : "Answering below resumes the worker.";
  return (
    <p className="w-full rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs leading-5 text-destructive" title={card.lastError}>
      <span className="font-semibold">Last worker error:</span> {card.lastError} {trailing}
    </p>
  );
}
