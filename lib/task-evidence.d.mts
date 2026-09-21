export interface TaskEvidenceInput {
  id?: string;
  name?: string;
  scope?: string;
}

export interface TaskEvidenceFinding {
  id: string;
  name: string;
  score: number | null;
  confidence: number | null;
  verdict: "met" | "unmet" | "unverifiable";
  error: string | null;
}

export interface ScopeEvidenceVerdict {
  id: string;
  name: string;
  status: string;
  verdict: "met" | "unmet" | "unverifiable" | "open";
  detail: string;
}

export declare const TASK_EVIDENCE_DIFF_CHARS: number;

export declare function tasksToScoreQuestions(
  tasks?: Array<TaskEvidenceInput | null> | null,
): Record<string, { type: string; instructions: string; criteria: string[] }>;

export declare function resolveTaskVerdicts(options: {
  tasks?: Array<TaskEvidenceInput | null> | null;
  answers?: Record<string, { type?: string; score?: number; confidence?: number } | null> | null;
  verdicts?: Record<string, { status?: string; confidence?: number | null } | null> | null;
  routeAt?: number | null;
}): TaskEvidenceFinding[];

export declare function resolveScopeVerdicts(options: {
  scopes?: Array<{ id?: string; name?: string; status?: string; tasks?: Array<{ id?: string }> | null } | null> | null;
  taskFindings?: Array<{ id?: string; verdict?: string } | null> | null;
}): ScopeEvidenceVerdict[];
