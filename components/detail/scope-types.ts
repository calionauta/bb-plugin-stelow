export type ScopeListTask = {
  id: string;
  name: string;
  status: string;
  source?: string | null;
  note?: string | null;
  conditions?: Array<{ type: string; message: string }> | null;
  blockedBy?: string[] | null;
  dependsOn?: string[] | null;
};

export type ScopeBlockedFile = { file: string; heldBy: string; expiresAt: number };

export type ScopeListScope = {
  id: string;
  name: string;
  type?: string | null;
  source?: string | null;
  gap?: string | null;
  status: string;
  startedAt?: string | null;
  record?: { completedAt?: string | null; verified?: boolean | null; filesCount?: number | null; commandsCount?: number | null } | null;
  tasks: ScopeListTask[];
  conditions?: Array<{ type: string; message: string }> | null;
  claimed?: boolean | null;
  claimFiles?: string[];
  blockedFiles?: ScopeBlockedFile[];
  contract?: { acceptanceCriteria: string[] } | null;
  blockedBy?: string[] | null;
  dependsOn?: string[] | null;
};
