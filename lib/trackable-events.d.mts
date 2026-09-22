export interface TrackableEvent {
  cardId: string;
  seq: number;
  at: number;
  kind: string;
  trackableId: string;
  transition: string;
  actor: string;
  evidence: string;
}
type Db = {
  exec(query: string): void;
  prepare(query: string): {
    run(...values: unknown[]): unknown;
    get(...values: unknown[]): any;
    all(...values: unknown[]): any[];
  };
};
export declare function ensureTrackableEventsTable(db: Db): void;
export declare function recordTrackableEvent(
  db: Db,
  options?: {
    cardId?: string;
    kind?: string;
    trackableId?: string;
    transition?: string;
    actor?: string;
    evidence?: string;
    at?: number;
  },
): number | null;
export declare function listTrackableEvents(db: Db, cardId?: string): TrackableEvent[];
