export interface ScoredVerdictFinding {
  id: string;
  name: string;
  score: number | null;
  confidence: number | null;
  verdict: "met" | "unmet" | "unverifiable";
  error: string | null;
}

export declare function resolveScoredVerdicts(options: {
  items?: Array<{ id?: string; name?: string } | null> | null;
  answers?: Record<string, { type?: string; score?: number; confidence?: number } | null> | null;
  verdicts?: Record<string, { status?: string; confidence?: number | null } | null> | null;
  keyPrefix: string;
  routeAt?: number | null;
}): ScoredVerdictFinding[];
