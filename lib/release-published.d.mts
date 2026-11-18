export interface ReleaseStateResult { state: "released" | "pending" | "unpublished"; reason: string }
export function classifyReleaseState(input: { version: unknown; latestTag: unknown; openReleaseVersions?: readonly unknown[] }): ReleaseStateResult;
export function describeReleaseState(result: ReleaseStateResult): string;
