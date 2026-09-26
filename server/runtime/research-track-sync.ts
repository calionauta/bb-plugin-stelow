import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { questionWaitUpdates } from "../../lib/card-question-state.mjs";
import { healPresetStaleness } from "../../lib/worker-ledger.mjs";
import type { WorkerCard } from "../workers-types.js";
import type { ResearchReadiness } from "./research-artifacts.js";
import {
  hasIdledLongEnough,
  isOpenTrackCard,
  isTerminalTrackStatus,
  settledIdleAt,
  trackSyncFailure,
  unknownExploreArtifact,
  unknownReadiness,
  type CardUpdate,
  type ExploreArtifactState,
  type TrackSyncDepsBase,
} from "./track-sync-core.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type ResearchTrackSyncDeps = TrackSyncDepsBase & {
  bb: BbPluginApi;
  db: Db;
  markThreadRunning: (card: WorkerCard, lastOutput: string | null) => Promise<void>;
  syncQuestions: (card: WorkerCard) => Promise<string[] | null>;
  noteAgentOutput: (card: WorkerCard, lastOutput: string | null) => void;
  applyFailed: (cardId: string, threadId: string, error: string | null) => Promise<void>;
  escalateIfStalled: (cardId: string) => void;
  researchReadiness: (card: WorkerCard) => Promise<ResearchReadiness>;
  exploreArtifact: (card: WorkerCard) => Promise<ExploreArtifactState>;
};

/** What an idle worker means for one track: the per-track completion rule. */
type SettledHandler = (
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  lastOutput: string | null,
) => Promise<void>;

const RESEARCH_IDLE_NOTE =
  "Idle with unfinished research — retry continues in place, restart begins fresh.";
const EXPLORE_IDLE_NOTE =
  "Idle with unfinished explore — retry continues in place, restart begins fresh.";

const completionFields = (
  lastOutput: string | null,
  idleAt: number,
): CardUpdate => ({
  status: "completed",
  activity: "idle",
  last_assistant_text: lastOutput,
  last_idle_at: idleAt,
});

const idleFields = (lastOutput: string | null, idleAt: number): CardUpdate => ({
  activity: "idle",
  last_assistant_text: lastOutput,
  last_idle_at: idleAt,
});

const INVALID_ROUND_REASONS: Record<string, string> = {
  "needs-depth": "needs depth",
  missing: "missing — write it",
  "mirrors-index": "mirrors the index — write the playbook output",
  thin: "thin — write the full playbook output",
};

function invalidRoundWhy(reason: string | undefined, detail: string | undefined): string {
  const base = INVALID_ROUND_REASONS[reason ?? ""] ?? "incomplete";
  return reason === "needs-depth" && detail ? `${base}: ${detail}` : base;
}

async function readThreadPoll(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
): Promise<{ status: string; lastOutput: string | null }> {
  const thread = await deps.bb.sdk.threads.get({
    threadId: card.worker_thread_id!,
  });
  const status = thread.status as string;
  try {
    const threadBorn = (thread as { createdAt?: number }).createdAt;
    healPresetStaleness(deps.db, card.id, threadBorn, card.preset_restart_pending);
  } catch {
    /* staleness stays best-effort */
  }
  const lastOutput =
    (
      await deps.bb.sdk.threads
        .output({ threadId: card.worker_thread_id! })
        .catch(() => null)
    )?.output ?? null;
  return { status, lastOutput };
}

/**
 * The one poll both standalone tracks run. Done is refused before the thread
 * is read, a failed read is a card error rather than a throw, and the stall
 * clock advances on every path that reaches the bottom — except the two that
 * deliberately bail out: a terminal card, and a question inbox that could not
 * be resolved (an unanswered poll is not a stall).
 */
async function sweepTrack(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  onSettled: SettledHandler,
): Promise<void> {
  if (isTerminalTrackStatus(card.status)) return;
  try {
    const { status, lastOutput } = await readThreadPoll(deps, card);
    if (status === "active" || status === "starting") {
      await deps.markThreadRunning(card, lastOutput);
    } else if (status === "idle" || status === "stopping") {
      const questionIds = await deps.syncQuestions(card);
      if (questionIds === null) return;
      if (questionIds.length > 0) {
        deps.updateCard(card.id, questionWaitUpdates(lastOutput));
      } else {
        await onSettled(deps, card, lastOutput);
      }
      deps.noteAgentOutput(card, lastOutput);
    } else if (status === "failed" || status === "error") {
      await deps.applyFailed(card.id, card.worker_thread_id!, null);
    }
  } catch (error) {
    deps.updateCard(card.id, trackSyncFailure(error));
  }
  deps.escalateIfStalled(card.id);
}

function completeTrack(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  lastOutput: string | null,
): void {
  const idleAt = settledIdleAt(card, deps.now);
  deps.updateCard(card.id, completionFields(lastOutput, idleAt));
  // Quiet completions record the trail too: a Done-column card without a
  // done event is invisible to flow metrics. Both tracks share this writer so
  // the trail cannot drift between them.
  deps.recordStageEvent(card.id, "done");
  deps.resolvePausedEvents(card.id, deps.now());
}

function noteIdlePaused(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  idleAt: number,
  message: string,
): void {
  if (!hasIdledLongEnough(idleAt, deps.now, deps.idleAttentionMs)) return;
  deps.recordInboxEvent(
    card,
    "paused",
    message,
    `paused:${card.id}:${idleAt}`,
    idleAt,
  );
}

/**
 * An idle worker that produced nothing reviewable: the card parks as idle
 * and `onParked` names every concrete defect. Ordering matters — the
 * specific defects are recorded before the generic "idle too long" nudge.
 */
function parkUnfinished(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  lastOutput: string | null,
  onParked: (current: WorkerCard, idleAt: number) => void,
): void {
  const idleAt = settledIdleAt(card, deps.now);
  deps.updateCard(card.id, idleFields(lastOutput, idleAt));
  const current = deps.getCard(card.id);
  if (!isOpenTrackCard(current)) return;
  onParked(current, idleAt);
}

function completeResearch(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  lastOutput: string | null,
  readiness: ResearchReadiness,
): void {
  completeTrack(deps, card, lastOutput);
  const current = deps.getCard(card.id);
  if (!current) return;
  const hypothesisSuffix =
    readiness.evidence === "hypothesis-only"
      ? " Marked hypothesis-only: web research was unavailable — requires human validation."
      : "";
  deps.recordInboxEvent(
    current,
    "completed",
    `Research complete — results ready to review in Done.${hypothesisSuffix}`,
    `completed:${card.id}:index:${readiness.fingerprint ?? "ready"}`,
    deps.now(),
  );
}

function flagInvalidRounds(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  readiness: ResearchReadiness,
): void {
  for (const round of readiness.invalid) {
    const item = round.slug ? `${round.label} — ${round.slug}` : round.label;
    const why = invalidRoundWhy(round.reason, round.detail);
    const key = round.slug
      ? `round-invalid:${card.id}:${round.n}:${round.slug}`
      : `round-invalid:${card.id}:${round.n}`;
    deps.recordInboxEvent(
      card,
      "error",
      `Round ${round.n} (${item}) ${why} — restart it to regenerate the result.`,
      key,
      deps.now(),
    );
  }
}

/**
 * Readiness already gates on artifact integrity: ready means the index is
 * reviewable AND every round file is valid. An index with invalid rounds is
 * not done — each invalid round is named as an inbox error so the human knows
 * exactly what to re-run. A readiness read that throws leaves the card
 * unfinished; it must never read as ready.
 */
async function researchSettled(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  lastOutput: string | null,
): Promise<void> {
  const readiness = await deps.researchReadiness(card).catch(() => unknownReadiness());
  if (readiness.ready) {
    completeResearch(deps, card, lastOutput, readiness);
    return;
  }
  parkUnfinished(deps, card, lastOutput, (current, idleAt) => {
    flagInvalidRounds(deps, current, readiness);
    noteIdlePaused(deps, current, idleAt, RESEARCH_IDLE_NOTE);
  });
}

function completeExplore(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  lastOutput: string | null,
  artifact: ExploreArtifactState,
): void {
  completeTrack(deps, card, lastOutput);
  const current = deps.getCard(card.id);
  if (!current) return;
  deps.recordInboxEvent(
    current,
    "completed",
    "Exploration complete — result ready to review in Done.",
    `explore-completed:${card.id}:${artifact.fingerprint ?? "ready"}`,
    deps.now(),
  );
}

/**
 * Explore has no index: done means the stage skill wrote its artifact with
 * real content. Same trail contract as research, but the defect is one
 * depth complaint, not a round list.
 */
async function exploreSettled(
  deps: ResearchTrackSyncDeps,
  card: WorkerCard,
  lastOutput: string | null,
): Promise<void> {
  const artifact = await deps.exploreArtifact(card).catch(() => unknownExploreArtifact());
  if (artifact.ready && card.status !== "completed") {
    completeExplore(deps, card, lastOutput, artifact);
    return;
  }
  if (artifact.ready) return;
  parkUnfinished(deps, card, lastOutput, (current, idleAt) => {
    if (artifact.failures.length > 0) {
      deps.recordInboxEvent(
        current,
        "error",
        `Explore ${card.explore_stage} needs depth — ${artifact.failures.join("; ")} — rewrite it, then run verify again.`,
        `explore-invalid:${card.id}`,
        deps.now(),
      );
    }
    noteIdlePaused(deps, current, idleAt, EXPLORE_IDLE_NOTE);
  });
}

/**
 * Worker polling for the two standalone tracks (research, explore).
 *
 * Both share one sweep — read the thread, heal preset staleness best-effort,
 * then dispatch on thread status — and differ only in what an idle worker
 * means. The per-track completion contract lives in the settled handlers:
 * research completes on a valid index, explore on a valid stage artifact.
 */
export function createResearchTrackSync(deps: ResearchTrackSyncDeps) {
  return {
    syncResearch: (card: WorkerCard) => sweepTrack(deps, card, researchSettled),
    syncExplore: (card: WorkerCard) => sweepTrack(deps, card, exploreSettled),
  };
}

export type ResearchTrackSync = ReturnType<typeof createResearchTrackSync>;
