export const MAX_LANE_ROWS: number;
export const MAX_LANE_WARNINGS: number;

export type LaneClaim = { key: string; path: string; symbol: string };
export type LanePair = {
  a: string;
  b: string;
  conflicts: LaneClaim[];
  conflictCount: number;
  sameFileRisk: string[];
  riskCount: number;
  contractTouch: string[];
  touchCount: number;
};
export type LaneSummary = {
  lanes: Array<{ id: string; task: string }>;
  pairs: LanePair[];
  landingOrder: string[];
  sequentialize: Array<{ a: string; b: string; reason: string }>;
  warnings: string[];
};

export function summarizePlanLanes(json: unknown): LaneSummary | null;
