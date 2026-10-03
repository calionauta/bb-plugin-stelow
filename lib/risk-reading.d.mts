export interface RiskInput {
  impact?: unknown;
  callers?: unknown;
  reversible?: unknown;
  check?: unknown;
}

export interface RiskReading {
  level: "high" | "moderate" | "low" | "unknown";
  reasons: string[];
}

export declare function riskReading(input: unknown): RiskReading;
