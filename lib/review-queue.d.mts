/** A stage a person has to approve, taken from the stage catalog. */
export interface ReviewQueueGate {
  id: string;
  label: string;
}

/**
 * One inbox event, as `listNotifications` returns it.
 *
 * Only the fields this projection reads; the ledger row is wider than this.
 */
export interface ReviewQueueEvent {
  cardId: string;
  kind: string;
  occurredAt: number | null;
  readAt?: number | null;
  resolvedAt?: number | null;
  archivedAt?: number | null;
}

/** The card fields the projection reads off the board's card list. */
export interface ReviewQueueCard {
  id: string;
  stage: string;
  displayName?: string | null;
  name?: string | null;
  activity?: string | null;
  updatedAt?: number | null;
}

export type ReviewQueueAgeSource = "entered" | "since_created" | "unknown";

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
