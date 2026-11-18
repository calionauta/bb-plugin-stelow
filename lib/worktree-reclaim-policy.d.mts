export interface CleanupIntegrationInput { unpushedCommits: number; changedFiles: number; untrackedFiles: number; remoteMerged: boolean; branchShared: boolean }
export interface CleanupIntegrationResult { safe: boolean; blockers: string[]; summary: string | null }
export function cleanupIntegration(input: CleanupIntegrationInput): CleanupIntegrationResult;
export interface WorktreeReclaimableInput { isGit: boolean; linkedWorktree: boolean; branch: string | null; sharedWith: number }
export function worktreeReclaimable(input: WorktreeReclaimableInput): string | null;
