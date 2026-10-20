/** Consecutive wasted scheduled visits before the gate stops trusting a card. */
export declare const MAX_WASTED_VISITS: number;
/** Is this card's next scheduled visit worth a model turn? Every refusal names
 * a reason a reader can act on. Pure: no host, no network, no model. */
export declare function shouldWake(options: {
  status: string;
  activity?: string;
  lastError?: string | null;
  lastIdleAt?: number | null;
  now?: number;
  autoCount?: number | null;
  readUnreachable?: boolean;
}): { wake: boolean; reason: string };
