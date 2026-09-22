export type TrackableStatus =
  | "pending"
  | "in-progress"
  | "blocked"
  | "done"
  | "completed"
  | "skipped"
  | "failed"
  | "escalated";
export interface TrackableCondition {
  type: string;
  reason: string;
  message: string;
  observedAt: string;
}
export declare const TRACKABLE_STATUSES: TrackableStatus[];
export declare function isDoneStatus(status: unknown): boolean;
export declare function isSkippedStatus(status: unknown): boolean;
export declare function isActiveStatus(status: unknown): boolean;
export declare function isKnownStatus(status: unknown): boolean;
export declare function cleanTrackableId(value: unknown): string | null;
export declare function canTransition(from: unknown, to: unknown): boolean;
export declare function buildCondition(options?: {
  type?: string;
  reason?: string;
  message?: string;
  observedAt?: string;
}): TrackableCondition | null;
export declare function hasCondition(conditions: unknown, type: string): boolean;
