export interface BoundaryContract {
  question: string;
  questionId: string | null;
  contractId: string;
  boundaryId: string;
  kind: "reaction" | "confirmation";
  status: "open" | "answered";
  shapeVersion: string;
  scopeMapVersion: string | null;
  answerSchema: unknown;
}

export interface ExecutionRun {
  id: string;
  cardId: string;
  projectId: string;
  runId: string | null;
  recipeId: string;
  stage: string;
  sourceHash: string;
  sourceText: string;
  argsText: string;
  adapter: string;
  workspaceId: string;
  artifactRoot: string;
  originThreadId: string;
  nativeStatus: string | null;
  normalizedStatus: "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
  startedAt: number;
  completedAt: number | null;
  resumeOf: string | null;
  errorCode: string | null;
  previewDirective: string | null;
  completionEventId: string | null;
  needsInputSentAt: number | null;
  resumeRequestedAt: number | null;
  boundaryId: string | null;
  boundaryQuestion: string | null;
  boundaryContract: BoundaryContract | null;
  createdAt: number;
  /**
   * When the host first stopped answering about this run. Null while it answers.
   *
   * Not public: it is the reconciler's own bookkeeping for a decaying liveness
   * signal, and a reader is told "the host stopped answering" through
   * `errorCode` once the window passes — not through a timestamp that would
   * only make them compute whether it has passed.
   */
  reconcileFailedAt?: number | null;
}
export type PublicExecutionRun = Pick<ExecutionRun,
  "id" | "cardId" | "runId" | "recipeId" | "stage" | "sourceHash" | "adapter" | "workspaceId" |
  "originThreadId" | "nativeStatus" | "normalizedStatus" | "startedAt" | "completedAt" |
  "resumeOf" | "errorCode" | "previewDirective" | "boundaryQuestion" | "completionEventId" | "boundaryContract" | "createdAt">;
export function projectExecutionRun(value: ExecutionRun): PublicExecutionRun;
export function ensureExecutionRunTable(db: any): void;
export function createExecutionRun(db: any, input: Record<string, any>): ExecutionRun;
export function getExecutionRun(db: any, id: string): ExecutionRun | null;
export function listExecutionRuns(db: any, cardId: string): ExecutionRun[];
export function activeExecutionRun(db: any, cardId: string): ExecutionRun | null;
export function transitionExecutionRun(db: any, id: string, next: string, patch?: Record<string, any>): ExecutionRun;
export function recordExecutionCompletion(db: any, id: string, eventId: string, status: string, patch?: Record<string, any>): { run: ExecutionRun; duplicate: boolean };
export function markExecutionNeedsInputSent(db: any, id: string, at?: number): ExecutionRun;
export function markExecutionResumeRequested(db: any, id: string, at?: number): ExecutionRun;
export function resumeArtifactRoot(artifactRoot: string): string;
export function resetExecutionBoundary(db: any, id: string): ExecutionRun;

/** When the host FIRST stopped answering about this run; null while it answers. */
export function markReconcileFailed(db: any, id: string, at: number): ExecutionRun;

/** The host answered again; the unreachable window closes. */
export function markReconcileReached(db: any, id: string): ExecutionRun;
export function cancelExecutionRuns(db: any, cardId: string, reason?: string): number;
