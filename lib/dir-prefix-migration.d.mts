export declare function swDirHash(dirHash: unknown): string;
export declare function needsPrefixMigration(dirHash: unknown): boolean;
export declare type DirRenamePlan = {
  workflowId: string;
  fromHash: string;
  toHash: string;
  fromStateRel: string;
  toStateRel: string;
  fromApprovalsRel: string;
  toApprovalsRel: string;
};
export declare function planDirRename(entry: unknown): DirRenamePlan | null;
export declare function applyDirRename(
  rootPath: string,
  plan: DirRenamePlan,
): { state: "moved" | "missing" | "collision"; approvals: "moved" | "missing" | "collision"; moved: Array<{ from: string; to: string }> };
export declare function migrateTrackingHashes(
  workflows: unknown,
  renames: Array<{ fromHash: string; toHash: string }>,
): { workflows: unknown[]; changed: number };
