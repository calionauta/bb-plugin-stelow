// Type declarations for lib/skills-sync-swap.mjs

export interface SyncResult {
  changed: boolean;
  updated: string[];
  created: string[];
  removed: string[];
  errors: string[];
}

export function syncWorkflowSkills(
  targetDir: string,
  opts: { ref: string; log?: (msg: string) => void; statePath?: string },
): Promise<SyncResult>;

export function syncHelperScript(
  repoRoot: string,
  opts?: { log?: (msg: string) => void; statePath?: string },
): Promise<SyncResult>;
