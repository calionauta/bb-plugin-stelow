export interface StageEvent {
  stage: string;
  entered_at: number;
}

export interface StageDuration {
  stage: string;
  ms: number;
}

export function summarizeTimeline(events: StageEvent[], bounds: { createdAt: number; endAt?: number }): { leadMs: number; cycleMs: number | null; byStage: StageDuration[] };

export function formatDuration(ms: number | null | undefined): string;
