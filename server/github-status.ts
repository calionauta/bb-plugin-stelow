/**
 * The GitHub status the board's column reads.
 *
 * One shape, one owner. A board read has to answer even when the issue
 * automation is not built yet, when the feature is switched off, and when the
 * probe fails — three ways of saying "not there". They used to be three inline
 * literals, and a fourth was parked in the composition root beside its wiring.
 * This is the type the RPC contract publishes and the one value all of them
 * fall back to, so a change to the contract has one place to change.
 */

export interface GithubStatus {
  ok: boolean;
  pluginAvailable: boolean;
  ghOk: boolean;
  repos: Array<{ repo: string; projectId: string | null }>;
}

/**
 * A factory, not a constant: every reader gets its own `repos` list. A shared
 * array would let one board's read leak into another's.
 */
export function githubUnavailableStatus(): GithubStatus {
  return { ok: false, pluginAvailable: false, ghOk: false, repos: [] };
}
