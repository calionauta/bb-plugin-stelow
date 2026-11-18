export interface MajorClaimResult { state: "in-line" | "major-claim"; reason: string; remedy: string | null }
export function classifyMajorClaim(input: { version: unknown; openReleaseVersions?: readonly unknown[] }): MajorClaimResult;
export function describeMajorClaim(result: MajorClaimResult): string;
