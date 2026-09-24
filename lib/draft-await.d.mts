export const DRAFT_POLL_MS: number;
export const DRAFT_POLLS: number;
export function awaitDraftThread(deps: {
  threadStatus: () => Promise<string | null>;
  threadOutput: () => Promise<string>;
  stopThread: () => Promise<unknown>;
  sleep: (ms: number) => Promise<unknown>;
}, threadId: string, options?: { pollMs?: number; polls?: number }): Promise<{ ok: boolean; output: string; error: string | null }>;
