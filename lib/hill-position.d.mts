export declare const HILL_CLUSTER_BUCKET: number;
export declare const HILL_PLOT: { base: number; span: number; margin: number };
export declare function hillDotPercent(point: { x?: number; y?: number } | null | undefined): { left: number; bottom: number };
export declare function hillSvgY(percentBottom: number, viewHeight?: number): number;
export declare function hillFraction(card: {
  status?: string;
  stage?: string;
  scopeSummary?: { tasksTotal?: number; tasksDone?: number; scopesTotal?: number; scopesDone?: number } | null;
} | null | undefined): number;
export declare function hillRegion(fraction: number): "uphill" | "downhill";
export declare function hillCurveY(x: number): number;
export declare function hillCurvePoints(samples?: number): Array<{ x: number; y: number }>;
export declare function hillPoint(card: {
  id?: string;
  status?: string;
  stage?: string;
  scopeSummary?: { tasksTotal?: number; tasksDone?: number; scopesTotal?: number; scopesDone?: number } | null;
} | null | undefined): { x: number; y: number; region: "uphill" | "downhill" };
export declare function clusterHillDots<T>(items: Array<{ card: T; point: { x: number } }> | null | undefined, bucket?: number): Array<{ x: number; cards: T[] }>;
