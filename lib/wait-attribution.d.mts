export interface WaitWindow {
  kind: string;
  start: number;
  end: number | null;
}

export interface WaitSplit {
  totalMs: number;
  humanMs: number;
  systemMs: number;
  attributedMs: number;
  unattributedMs: number;
  humanShare: number;
  systemShare: number;
  unattributedShare: number;
}

export declare function unionLengthMs(intervals: Array<{ start: number; end: number }>): number;

export declare function shareOf(partMs: number, totalMs: number): number;

export declare function splitWaitWindows(options: {
  windows: WaitWindow[];
  startAt: number;
  endAt: number;
}): WaitSplit;

export declare function attributeCardWait(db: {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
}, options: { cardId: string; startAt: number; endAt: number }): WaitSplit;

export declare function reviewWaitMs(db: {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
}, options: { cardId: string; nowMs: number }): number | null;
