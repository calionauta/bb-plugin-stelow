export declare const GATE_EVIDENCE_STAGES: string[];
export declare const PER_OPTION_EVIDENCE_STAGES: string[];
export declare function gateEvidenceGate(input: {
  kind: unknown;
  stage: unknown;
  tag: unknown;
  forced: unknown;
  groups: unknown;
}): { allowed: boolean; error: string | null };
