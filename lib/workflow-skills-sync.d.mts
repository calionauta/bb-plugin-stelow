// Type declarations for lib/workflow-skills-sync.mjs

export interface SyncResult {
  changed: boolean;
  updated: string[];
  created: string[];
  removed: string[];
  errors: string[];
}

export function syncWorkflowSkills(
  targetDir: string,
  opts?: { log?: (msg: string) => void },
): Promise<SyncResult>;

export const WORKFLOW_SKILLS: string[];