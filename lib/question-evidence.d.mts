/* from lib/gate-ask-evidence.d.mts */
export declare const GATE_EVIDENCE_STAGES: string[];
export declare const PER_OPTION_EVIDENCE_STAGES: string[];
export declare function gateEvidenceGate(input: {
  kind: unknown;
  stage: unknown;
  tag: unknown;
  forced: unknown;
  groups: unknown;
}): { allowed: boolean; error: string | null };

/* from lib/task-evidence.d.mts */
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

export declare function taskVerifyCommand(task: unknown): string | null;

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

/* from lib/question-answer-recording.d.mts */
export declare const EXPIRED_QUESTION_ID_PREFIX: "expired:";
export declare function expiredQuestionId(rowId: string): string;
export declare function isExpiredQuestionId(questionId: unknown): boolean;
export declare function expiredQuestionRowId(questionId: string): string;
export declare function parseAnswerArgs(args: unknown): { pairs?: Array<{ question: string; answer: string }>; json?: boolean; error?: string };
export declare function buildAnswerPayload(pairs: unknown): {
  live: Array<{ questionId: string; answers: string[] }>;
  expired: Array<{ questionId: string; answers: string[] }>;
};
export declare function answerCommentBody(decisions: unknown): string | null;
export declare function answeredCardPatch(hasOpenQuestions: boolean): {
  activity: "awaiting-answer" | "running";
  status: "in-progress";
  last_error: null;
};

/* from lib/ask-persist-failure.d.mts */
export function shouldRecordPersistFailure(input: {
  persisted: boolean;
  error: string | null | undefined;
}): boolean;

export function persistFailureTrailLine(input: {
  threadId: string;
  error: string;
}): string;

export interface PersistFailureInboxEvent {
  card: { id: string };
  kind: "error";
  summary: string;
  dedupeKey: string;
  occurredAt: number;
}

export function persistFailureInboxEvent(input: {
  cardId: string;
  error: string;
}): PersistFailureInboxEvent;

