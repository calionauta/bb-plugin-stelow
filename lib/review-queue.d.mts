export interface ReviewQueueGate {
  id: string;
  label: string;
  phase: string;
}

export interface ReviewQueueEvent {
  cardId?: string;
  kind: string;
  occurredAt: number;
  readAt?: number | null;
  resolvedAt?: number | null;
  archivedAt?: number | null;
}

export interface ReviewQueueCard {
  id: string;
  name?: string | null;
  displayName?: string | null;
  stage: string;
  activity?: string | null;
  updatedAt?: number | null;
}

/** `entered` is the wait's own start; `since_created` a bound read off the card's record. */
export type ReviewQueueAgeSource = "entered" | "since_created" | "unknown";

/** `system` rows are excluded from the queue: a worker owns the card, not the reader. */
export type ReviewQueueWaitingOn = "human" | "system" | "unattributed";

export interface ReviewQueueAttribution {
  waitingOn: ReviewQueueWaitingOn;
  enteredAt: number | null;
  ageSource: ReviewQueueAgeSource;
}

export interface ReviewQueueRow extends ReviewQueueAttribution {
  id: string;
  name: string;
  stage: string;
  gate: string;
  updatedAt: number;
}

export interface ReviewQueueBadge {
  count: number;
  oldest: string | null;
  label: string;
}

export interface ReviewQueueGateRead {
  id: string;
  label: string;
  state: "ok" | "failed";
  count: number;
}

export interface ReviewQueueLegendEntry {
  cell: string;
  meaning: string;
}

export declare const REVIEW_QUEUE_WIDTH_PX: number;
export declare const REVIEW_QUEUE_RAIL_STYLE: Readonly<{
  position: "fixed";
  top: number;
  bottom: number;
  right: number;
  zIndex: number;
  width: number;
}>;
export declare const REVIEW_QUEUE_ROW_PX: number;
export declare const REVIEW_QUEUE_TICK_MS: number;
export declare const REVIEW_QUEUE_GATES: ReadonlyArray<ReviewQueueGate>;
export declare const REVIEW_QUEUE_GATE_IDS: ReadonlyArray<string>;
export declare const REVIEW_QUEUE_AGE_LEGEND: ReadonlyArray<ReviewQueueLegendEntry>;

export declare function isReviewGate(stage: string): boolean;
export declare function reviewGateLabel(stage: string): string;
export declare function isHumanWait(event: ReviewQueueEvent): boolean;
export declare function isSystemWait(event: ReviewQueueEvent): boolean;

export declare function attributionOf(
  card: ReviewQueueCard,
  events?: ReadonlyArray<ReviewQueueEvent>,
): ReviewQueueAttribution;

export declare function orderQueueRows(rows: ReadonlyArray<ReviewQueueRow>): ReviewQueueRow[];

export declare function reviewQueueRows(options?: {
  cards?: ReadonlyArray<ReviewQueueCard>;
  notifications?: ReadonlyArray<ReviewQueueEvent>;
  ledgerOk?: boolean;
}): ReviewQueueRow[];

export declare function queueAgeCell(row: ReviewQueueRow, nowMs: number): string;

export declare function reviewQueueBadge(
  rows: ReadonlyArray<ReviewQueueRow>,
  options?: { ledgerOk?: boolean; nowMs?: number },
): ReviewQueueBadge;

export declare function reviewQueueGateReads(
  rows: ReadonlyArray<ReviewQueueRow>,
  options?: { ledgerOk?: boolean },
): ReviewQueueGateRead[];
