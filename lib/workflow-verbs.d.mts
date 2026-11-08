export interface WorkflowVerb {
  host: string | null;
  surface: "helper" | "host" | "internal";
}
export declare const WORKFLOW_VERBS: Readonly<Record<string, WorkflowVerb>>;
export declare const HELPER_VERBS: readonly string[];
export declare const HOST_WORKFLOW_VERBS: readonly string[];
export declare function internalVerbReason(verb: string): string | null;
