export function resolveWithinRoot(
  rootPath: string,
  candidate: string,
  opts?: { allowlist?: string[] },
): string | null;

export function isPathWithinRoot(
  rootPath: string,
  candidate: string,
  opts?: { allowlist?: string[] },
): boolean;
