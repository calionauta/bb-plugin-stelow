/**
 * A loader that runs one pass at a time and coalesces arrivals during a run
 * into a single follow-up pass.
 */
export declare function createCoalescedLoader(
  load: () => Promise<unknown>,
): () => Promise<void>;
