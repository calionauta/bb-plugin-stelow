/** The one error the host proves needs no human: the recipe did nothing. */
export declare const EMPTY_OUTPUT_ERROR: "the recipe produced no task outputs";

/** Automatic attempts spent before the card parks and asks. */
export declare const MAX_AUTO_RETRIES: 1;

/** Whether a failed run qualifies for a host-driven retry. */
export declare function shouldAutoRetryRun(input: {
  errorCode: unknown;
  autoRetryCount: unknown;
}): boolean;
