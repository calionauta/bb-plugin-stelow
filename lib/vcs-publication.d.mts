export function publicationBlocker(status: any): string | null;
export function isDefaultBranchCheckout(status: any): boolean;
export function canCommitPublication(status: any): { ok: boolean; reason: string | null };
export function canSquashMerge(status: any): { ok: boolean; reason: string | null };
export function canMarkPullRequestReady(status: any, pullRequest: any): { ok: boolean; reason: string | null };
export function canMarkPullRequestDraft(status: any, pullRequest: any): { ok: boolean; reason: string | null };
export function canMergePullRequest(status: any, pullRequest: any): { ok: boolean; reason: string | null };
export function publicationSource(environment: any): string;
