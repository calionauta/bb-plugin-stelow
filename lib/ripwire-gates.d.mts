export declare const MAX_GATE_ROWS: number;

export interface TestGateSummary {
  changed: number;
  impacted: number;
  tests: number;
  untested: number;
  testsToRun: string[];
  untestedBlastRadius: unknown[];
  obligations: boolean;
}

export interface QualityDeltaSummary {
  baseline: string | null;
  refs: string[];
  regressions: number;
  minor: number;
  gating: number;
  blocked: boolean;
}

export declare function summarizeTestGate(json: unknown): TestGateSummary | null;
export declare function summarizeQualityDelta(json: unknown): QualityDeltaSummary | null;
