export declare function doneEligibility(options: {
  kind: string;
  stage?: string | null;
  questionPending: boolean;
  scopesOpen?: Array<{ id?: string; name?: string; status?: string }>;
}): string | null;
