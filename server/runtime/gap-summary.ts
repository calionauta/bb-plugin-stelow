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
  items: Array<{ description: string; scopeStatus: string | null }>;
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
): GapSummary {
  const linked = state.escalated.map((gap) => {
    const scope = state.auditGapScopes.find((entry) => entry.gap === gap.description);
    return { description: gap.description, scopeStatus: scope?.status ?? null };
  });
  return {
    matched: true,
    total: state.totals.total,
    fixed: state.totals.fixed,
    documented: state.totals.documented,
    escalated: state.totals.escalated,
    items: linked,
    pendingScopes: state.auditGapScopes.filter((scope) => !isDoneStatus(scope.status)).length,
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
    return buildGapSummary(card, state, timeline, deps.isDoneStatus);
  };
}
