export interface AdvanceGateResult {
  refusal: string | null;
  note: string | null;
}
export declare function advanceExecutionGates(options?: {
  kind?: string;
  stage?: string;
  specContent?: unknown;
  syncedCount?: number;
  cycles?: string[][] | null;
  hasUnstartablePending?: boolean;
  intent?: string;
  hasScopeMap?: boolean;
}): AdvanceGateResult;
export declare function doneBuildGates(options?: {
  kind?: string;
  stage?: string | null;
  scopes?: Array<{
    id?: string;
    name?: string;
    status?: string;
    record?: { verified?: boolean } | null;
    tasks?: Array<{ id?: string; name?: string; status?: string } | null> | null;
  } | null> | null;
  specMachine?: number;
  specHuman?: number;
  specContent?: unknown;
}): string | null;
