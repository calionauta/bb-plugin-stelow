export interface StageTrailEntry {
  stage: string;
  enteredAt: string | null;
  leftAt: string | null;
}

export function parseStageTrail(stateBlob: string | null | undefined): StageTrailEntry[];

export function renderStageTrail(trail?: StageTrailEntry[] | null): string[];
