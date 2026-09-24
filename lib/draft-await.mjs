/**
 * Shared draft-thread lifecycle: poll until the worker settles, extract its
 * output, stop it. Used by the `bb stelow draft` CLI path and the
 * done-comment draft RPC — one implementation so timeout, stop, and failure
 * semantics cannot drift between callers. All host access is injected, so
 * the loop is unit-tested with scripted threads and instant sleeps.
 */
export const DRAFT_POLL_MS = 5000;
export const DRAFT_POLLS = 36;

function draftTimeoutMessage(threadId, pollMs, polls) {
  const minutes = Math.round((pollMs * polls) / 60000);
  return `Draft thread ${threadId} still running after ${minutes} minutes — stopped; do the draft yourself.`;
}

export async function awaitDraftThread({ threadStatus, threadOutput, stopThread, sleep }, threadId, { pollMs = DRAFT_POLL_MS, polls = DRAFT_POLLS } = {}) {
  for (let poll = 0; poll < polls; poll++) {
    const status = await threadStatus().catch(() => null);
    if (status === "idle" || status === "stopping" || status === "archived" || status === "deleted") break;
    if (status === "failed" || status === "error") {
      await stopThread().catch(() => undefined);
      return { ok: false, output: "", error: `Draft thread ${threadId} ended with status ${String(status)} — do the draft yourself.` };
    }
    if (poll === polls - 1) {
      await stopThread().catch(() => undefined);
      return { ok: false, output: "", error: draftTimeoutMessage(threadId, pollMs, polls) };
    }
    await sleep(pollMs);
  }
  const output = await threadOutput().catch(() => "");
  await stopThread().catch(() => undefined);
  return { ok: true, output, error: null };
}
