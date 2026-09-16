export type StelowUpdateState = "checking" | "current" | "available" | "unavailable";

export function compareStelowVersions(left: string, right: string): number | null;
export function latestStelowRelease(releases: unknown): { tag_name: string; html_url?: string | null } | null;
export function checkStelowUpdate(fetchImpl?: typeof fetch): Promise<{ version: string; url: string | null }>;
