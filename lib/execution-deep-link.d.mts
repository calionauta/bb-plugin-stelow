export type ExecutionRunTrack = "inbox" | "build" | "research" | "explore";
export type ExecutionRunState = "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
export interface ExecutionRunDeepLinkInput {
  track?: ExecutionRunTrack;
  cardId?: string;
  localRunId?: string;
  status?: ExecutionRunState;
}
export interface ExecutionRunDeepLink {
  kind: "card-run";
  track: ExecutionRunTrack;
  cardId: string;
  localRunId: string;
  status: ExecutionRunState;
  focus: "run" | "question" | "history";
}
export interface ParsedExecutionRunSubPath {
  track: ExecutionRunTrack | null;
  cardId: string;
  eventId: string | null;
  localRunId: string;
}
export declare function executionRunDeepLink(input?: ExecutionRunDeepLinkInput): ExecutionRunDeepLink | null;
export declare function executionRunSubPath(input?: ExecutionRunDeepLinkInput): string | null;
export declare function executionRunFocus(input?: { localRunId?: string; status?: ExecutionRunState; hasQuestion?: boolean }): string | null;
export declare function parseExecutionRunSubPath(subPath?: string): ParsedExecutionRunSubPath | null;
