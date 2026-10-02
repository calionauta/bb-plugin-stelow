type DiscardEvidence = {
  status: string;
  workspaceKind: string;
  checkoutPath: string | null;
  dirExists: boolean;
  isGit: boolean;
  branch: string | null;
  hasUpstream: boolean;
  upstreamRef: string | null;
  changed: string[];
  untracked: string[];
  unpushedCommits: number;
  /** A merge into the base branch was recorded in the publication ledger —
   * the only signal that survives a squash merge. */
  remoteMerged?: boolean;
  /** The base branch already contains this branch's files — a positive proof
   * that also survives a squash, unlike any commit count. */
  treeMatchesBase?: boolean;
  stashCount: number;
  resetTarget: string | null;
  linkedWorktree: boolean;
  sharedWith: number;
};
type DiscardAction = "worktree-drop" | "branch-reset" | "dir-delete";
export declare const SHARED_BRANCH_PATTERN: RegExp;
export declare const MAX_PREVIEW_FILES: number;
export declare function discardEligibility(evidence: Partial<DiscardEvidence>): { eligible: boolean; action: DiscardAction | null; reason: string | null };
export declare function previewFileSample(changed?: string[], untracked?: string[]): string;
export declare function discardConfirm(evidence: Partial<DiscardEvidence>, action: DiscardAction): { title: string; body: string };
export declare function discardTrail(action: DiscardAction, evidence: Partial<DiscardEvidence>): string;
export declare function cleanupEligibility(evidence: Partial<DiscardEvidence>): { eligible: boolean; reason: string | null };
/**
 * The integration gate: is this card's work already somewhere it can be got
 * back from? Separate from cleanupEligibility on purpose — one answers
 * "is there a worktree to remove", the other "is the work safe to lose".
 */
export declare function cleanupIntegrationGate(evidence: Partial<DiscardEvidence>): {
  safe: boolean;
  blockers: string[];
  summary: string | null;
};
export declare function cleanupConfirm(evidence: Partial<DiscardEvidence>): { title: string; body: string };
export declare function cleanupTrail(evidence: Partial<DiscardEvidence>): string;
