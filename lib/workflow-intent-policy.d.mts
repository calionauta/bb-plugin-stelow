export declare type WorkflowIntentCard = {
  kind?: string | null;
  stage?: string | null;
  status?: string | null;
} | null | undefined;

export declare function canEditWorkflowIntent(card: WorkflowIntentCard): boolean;
export declare function canReclassifyWorkflow(card: WorkflowIntentCard): boolean;
export declare function resolveReseedIntent(card: Exclude<WorkflowIntentCard, null | undefined> & { intent: string }, requestedIntent?: string): { intent: string; reclassified: boolean } | null;
export declare function freshStatusForReseed(card: Exclude<WorkflowIntentCard, null | undefined> & { status: string }, reclassified: boolean): string;
