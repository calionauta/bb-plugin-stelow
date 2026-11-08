/** The plugin's own resume budget, reused as the gate's ceiling. */
export declare const MAX_RESUME_ATTEMPTS: number;
/** The card fields a visit could change. Equal fingerprints mean the last
 * visit changed none of them. */
export declare function wakeFingerprint(card: {
  status: string;
  activity?: string;
  stage?: string | null;
  lastError?: string | null;
}): string;
/** Is this card's next scheduled visit worth a model turn? Every refusal names
 * a reason a reader can act on. Pure: no host, no network, no model. */
export declare function shouldWake(options: {
  status: string;
  activity?: string;
  stage?: string | null;
  lastError?: string | null;
  lastIdleAt?: number | null;
  now?: number;
  autoCount?: number | null;
  readUnreachable?: boolean;
  unchangedSinceVisit?: boolean;
}): { wake: boolean; reason: string };
