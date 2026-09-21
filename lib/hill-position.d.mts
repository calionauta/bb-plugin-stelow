export declare const HILL_LANES: number;
export declare function hillFraction(card: {
  status?: string;
  stage?: string;
  scopeSummary?: { tasksTotal?: number; tasksDone?: number; scopesTotal?: number; scopesDone?: number } | null;
} | null | undefined): number;
export declare function hillRegion(fraction: number): "uphill" | "downhill";
export declare function hillLane(key: unknown, lanes?: number): number;
export declare function hillPoint(card: {
  id?: string;
  status?: string;
  stage?: string;
  scopeSummary?: { tasksTotal?: number; tasksDone?: number; scopesTotal?: number; scopesDone?: number } | null;
} | null | undefined): { x: number; y: number; lane: number; region: "uphill" | "downhill" };
