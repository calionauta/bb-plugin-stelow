export declare function doneEligibility(options: {
  kind: string;
  stage?: string | null;
  questionPending: boolean;
  scopesOpen?: Array<{ id?: string; name?: string; status?: string }>;
}): string | null;
export declare function doneScopeSyncRefusal(options?: {
  kind?: string;
  stage?: string | null;
  scopesOpen?: Array<{ id?: string; name?: string; status?: string } | null> | null;
  specMachine?: number;
  specHuman?: number;
}): string | null;
