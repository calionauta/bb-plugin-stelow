import type { WorkerCard } from "../workers-types.js";
import type { CritiqueGapState } from "./critique-gap-state.js";

type StageEvent = { stage: string; entered_at: number };
type Timeline = { leadMs: number | null; cycleMs: number | null };
type GapSummary = {
  matched: boolean;
  total: number;
  fixed: number;
  documented: number;
  escalated: number;
  items: Array<{ description: string; resolution: string; scopeStatus: string | null }>;
  pendingScopes: number;
  unscoped: number;
  leadMs: number | null;
  cycleMs: number | null;
  done: boolean;
};

type GapSummaryDeps = {
  getCard: (cardId: string) => WorkerCard | undefined;
  stageEvents: (cardId: string) => StageEvent[];
  summarizeTimeline: (events: StageEvent[], input: { createdAt: number; endAt: number }) => Timeline;
  critiqueGapState: (card: WorkerCard) => Promise<CritiqueGapState>;
  isDoneStatus: (status: string) => boolean;
  // Required here for the same reason it is required on the function below: an
  // optional dep is a dep a caller can forget, and forgetting it restores the
  // bug this dep exists to fix.
  isSkippedStatus: (status: string) => boolean;
  now: () => number;
};

function emptySummary(): GapSummary {
  return {
    matched: false,
    total: 0,
    fixed: 0,
    documented: 0,
    escalated: 0,
    items: [],
    pendingScopes: 0,
    unscoped: 0,
    leadMs: null,
    cycleMs: null,
    done: false,
  };
}

export function buildGapSummary(
  card: WorkerCard,
  state: CritiqueGapState,
  timeline: Timeline,
  isDoneStatus: (status: string) => boolean,
  // Required, not defaulted. A default of `() => false` means a caller that
  // forgets the dep gets the old behaviour - every skipped scope counted as
  // open - with no error anywhere, which is the exact defect this fixes. The
  // optional call goes with it: there is nothing left to be optional.
  isSkippedStatus: (status: string) => boolean,
): GapSummary {
  // Every finding the registry named, not just the escalated slice. Only an
  // escalation gets a rework scope, so `scopeStatus` stays null for the rest —
  // and a fixed or documented gap still appears, carrying the disposition that
  // closed it. A list that showed only escalations could not account for a
  // total that counts all of them.
  const items = state.gaps.map((gap) => {
    const scope = gap.resolution === "escalate"
      ? state.auditGapScopes.find((entry) => entry.gap === gap.description)
      : undefined;
    return { description: gap.description, resolution: gap.resolution, scopeStatus: scope?.status ?? null };
  });
  return {
    matched: true,
    total: state.totals.total,
    fixed: state.totals.fixed,
    documented: state.totals.documented,
    escalated: state.totals.escalated,
    items,
    // Skipped is resolved, not pending (lib/trackables.mjs): a set-aside scope
    // must not inflate the open count the card shows.
    pendingScopes: state.auditGapScopes.filter(
      (scope) => !isDoneStatus(scope.status) && !isSkippedStatus(scope.status),
    ).length,
    unscoped: state.escalated.filter(
      (gap) => !state.auditGapScopes.some((scope) => scope.gap === gap.description),
    ).length,
    leadMs: timeline.leadMs,
    cycleMs: timeline.cycleMs,
    done: card.status === "completed",
  };
}

export function createGapSummary(deps: GapSummaryDeps) {
  return async function gapSummary({ cardId }: { cardId: string }): Promise<GapSummary> {
    const card = deps.getCard(cardId);
    if (!card) return emptySummary();
    const events = deps.stageEvents(cardId);
    const doneEvent = [...events].reverse().find((event) => event.stage === "done");
    const timeline = deps.summarizeTimeline(events, {
      createdAt: card.created_at,
      endAt: doneEvent ? doneEvent.entered_at : deps.now(),
    });
    const state = await deps.critiqueGapState(card).catch(() => null);
    if (!state?.matched) {
      return {
        ...emptySummary(),
        leadMs: timeline.leadMs,
        cycleMs: timeline.cycleMs,
        done: card.status === "completed",
      };
    }
    return buildGapSummary(card, state, timeline, deps.isDoneStatus, deps.isSkippedStatus);
  };
}
