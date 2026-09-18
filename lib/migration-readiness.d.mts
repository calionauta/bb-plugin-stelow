export function parseSemverParts(value: string): number[] | null;
export function versionAtLeast(version: string, floor: string): boolean;
export function stelowRangeCoversCurrentLine(range: string): boolean;
export function highestSatisfyingTag(lsRemoteOutput: string, floor: string): string | null;