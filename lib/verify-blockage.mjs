/**
 * Whether a verify failure that parks a card on open questions is still the
 * failure the card should act on.
 *
 * `done` binds verification to an exact Git identity (root plus HEAD), so a
 * test run that failed on yesterday's tree says nothing about today's — and a
 * run that failed on THIS tree will fail again. The reader needs to know
 * which one they are looking at before they spend a re-verify or wake the
 * worker, because the two ask for opposite actions.
 *
 * States: `clear` (verified on this exact HEAD — the block, if any, is not
 * verify), `stale` (the tree moved since the run — the failure may be stale),
 * `confirmed` (failed on this exact HEAD — re-running changes nothing),
 * `unknown` (no run, no HEAD, or nothing to compare).
 */

export const VERIFY_BLOCKAGE_STATES = ["clear", "stale", "confirmed", "unknown"];

export function classifyVerifyBlockage({ latestRun, currentHeadSha }) {
  const runHead = typeof latestRun?.headSha === "string" && latestRun.headSha ? latestRun.headSha : null;
  const nowHead = typeof currentHeadSha === "string" && currentHeadSha ? currentHeadSha : null;
  const unresolved = { state: "unknown", exitCode: null, runHeadSha: null, currentHeadSha: nowHead };
  if (!latestRun || typeof latestRun.exitCode !== "number" || !runHead || !nowHead) return unresolved;
  if (runHead === nowHead) {
    return latestRun.exitCode === 0
      ? { state: "clear", exitCode: 0, runHeadSha: runHead, currentHeadSha: nowHead }
      : { state: "confirmed", exitCode: latestRun.exitCode, runHeadSha: runHead, currentHeadSha: nowHead };
  }
  return { state: "stale", exitCode: latestRun.exitCode, runHeadSha: runHead, currentHeadSha: nowHead };
}
