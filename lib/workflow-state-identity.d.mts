export declare function workflowEntryForOwner(workflows: unknown[], workflowId: string, dirHash?: string | null): unknown | null;
export declare function workflowStateRelativeDir(entry: unknown): string | null;
export declare function workflowDirHash(workflowId: string, fresh?: boolean, timestamp?: number): string;
export declare function stateWorkflowId(stateBlob: unknown): string;
export declare function ownsWorkflowState(stateBlob: unknown, workflowId: string): boolean;
export declare function upsertWorkflowEntry(workflows: unknown[], nextEntry: unknown): unknown[];
