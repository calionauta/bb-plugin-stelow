export interface EvidenceContract {
  acceptanceCriteria: string[];
  verifyCommands: string[];
  targetFiles: string[];
}
export interface EvidenceRecord {
  verified?: boolean;
  filesCount?: number;
  commandsCount?: number;
  completedAt?: string;
  startedAt?: string;
  suggestedCommit?: string;
}
export interface EvidenceCondition {
  type: string;
  reason: string;
  message: string;
  observedAt: string;
}
export declare function contractRelPath(
  stateRelDir: unknown,
  kind: unknown,
  id: unknown,
  parentId?: unknown,
): string | null;
export declare function parseEvidenceContract(content: unknown): EvidenceContract | null;
export declare function sanitizeEvidenceRecord(raw: unknown): EvidenceRecord | null;
export declare function evidenceConditions(options?: {
  entry?: {
    id?: string;
    kind?: string;
    name?: string;
    status?: string;
    startedAt?: string;
    record?: EvidenceRecord | null;
    contract?: EvidenceContract | null;
    tasks?: unknown;
    children?: unknown;
    blockedBy?: unknown;
    dependsOn?: unknown;
  } | null;
  registry?: Map<string, { id?: string; status?: string; name?: string }> | null;
  claimed?: boolean | null;
  claimLapsed?: boolean;
}): EvidenceCondition[];
