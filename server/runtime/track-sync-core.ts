import type { WorkerCard } from "../workers-types.js";
import type { ResearchReadiness } from "./research-artifacts.js";

export type CardUpdate = Record<string, unknown>;

export type ExploreArtifactState = {
  ready: boolean;
  fingerprint: string | null;
  failures: string[];
};

export type InboxKind = "error" | "paused" | "completed";

export type TrackSyncDepsBase = {
  getCard: (cardId: string) => WorkerCard | undefined;
  updateCard: (cardId: string, fields: CardUpdate) => void;
  recordInboxEvent: (
    card: WorkerCard,
    kind: InboxKind,
    message: string,
    key: string,
    at: number,
  ) => void;
  resolvePausedEvents: (cardId: string, at: number) => void;
  recordStageEvent: (cardId: string, stage: string) => void;
  now: () => number;
  idleAttentionMs: number;
};

/**
 * Done is terminal for the standalone tracks too: a background poll may not
 * write failure, idle, or completion onto a card a human already finished.
 * Shared by research and explore so the two can never drift apart.
 */
export function isTerminalTrackStatus(status: string): boolean {
  return (
    status === "completed" || status === "archived" || status === "blocked"
  );
}

/** True while the card is still actionable for inbox writes. */
export function isOpenTrackCard(
  card: WorkerCard | undefined,
): card is WorkerCard {
  return !!card && card.status !== "archived" && card.status !== "completed";
}

/**
 * A card that is already idle keeps its original idle stamp so the attention
 * clock measures "idle this long" across polls, not "idle since this poll".
 */
export function settledIdleAt(card: WorkerCard, now: () => number): number {
  return card.activity !== "idle" || !card.last_idle_at ? now() : card.last_idle_at;
}

/** Fail-soft read: a thread we cannot read is an error activity, not a throw. */
export function trackSyncFailure(error: unknown): CardUpdate {
  return {
    activity: "error",
    last_error:
      error instanceof Error
        ? error.message
        : "Unable to read worker thread.",
  };
}

/**
 * Readiness that could not be computed must never read as "done": a broken
 * artifact read leaves the card idle and the work unfinished.
 */
export function unknownReadiness(): ResearchReadiness {
  return { ready: false, fingerprint: null, evidence: "verified", invalid: [] };
}

export function unknownExploreArtifact(): ExploreArtifactState {
  return { ready: false, fingerprint: null, failures: [] };
}

export function hasIdledLongEnough(
  idleAt: number,
  now: () => number,
  idleAttentionMs: number,
): boolean {
  return !!idleAt && now() - idleAt >= idleAttentionMs;
}
