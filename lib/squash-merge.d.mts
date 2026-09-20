export declare const SQUASH_EXIT_MARKER: string;
export declare const SQUASH_SHA_MARKER: string;
export declare const SQUASH_DONE_MARKER: string;
export declare const SQUASH_EXIT_CONFLICT: number;
export declare const SQUASH_EXIT_COMMIT_FAILED: number;
export declare const SQUASH_EXIT_BASE_CHECKOUT_FAILED: number;

export declare function shellQuote(value: string): string;

export declare function buildSquashScript(options: {
  base: string;
  branch: string;
  message: string;
}): string;

export declare function parseSquashOutput(text: string | null | undefined): {
  finished: boolean;
  exit: number | null;
  sha: string | null;
};

export declare function squashExitMessage(
  exit: number | null | undefined,
  branch: string,
  base: string,
): string;
