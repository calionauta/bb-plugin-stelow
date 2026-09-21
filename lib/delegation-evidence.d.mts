export interface DelegationEvidenceSummary {
  observed: boolean;
  summary: string;
}

export declare function countDelegations(value: unknown): number;

export declare function summarizeDelegationEvidence(options: {
  delegations?: number | null;
  truncated?: boolean | null;
}): DelegationEvidenceSummary;
