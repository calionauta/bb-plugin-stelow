export declare function normalizePromoteName(raw: unknown, fallback: unknown): string;
export declare function findAdoptableProject(
  projects: unknown,
  name: string,
  workspacePath: string,
): { action: "create" } | { action: "adopt"; project: { id: string; name: string } } | { action: "conflict"; project: { id: string; name: string } };
