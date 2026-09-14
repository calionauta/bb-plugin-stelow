export function publicationBlocker(status: any): string | null;
export function canCommitPublication(status: any): { ok: boolean; reason: string | null };
export function canSquashMerge(status: any): { ok: boolean; reason: string | null };
export function canMergePullRequest(pullRequest: any): { ok: boolean; reason: string | null };
export function publicationSource(environment: any): string;
