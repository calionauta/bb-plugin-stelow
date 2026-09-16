export declare const AUDIT_TRAIL_CONTRACT: "v3";
export declare const AUDIT_TRAIL_FILE: "audit-trail.md";
export declare const AUDIT_TRAIL_NOTE: string;

export interface AuditTrailSnapshot {
  root?: string;
  head?: string;
  tracked?: string;
  untracked?: string;
  untracked_count?: number;
}

export interface AuditTrailResult {
  ok: boolean;
  contract?: string;
  path?: string;
  artifacts?: number;
  unregistered?: number;
  snapshot?: AuditTrailSnapshot;
  error?: string;
}

export interface AuditTrailRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type AuditTrailState = "verified" | "changed" | "missing" | "refused" | "unsupported" | "unavailable";

export function parseAuditTrailResult(stdout: unknown): AuditTrailResult | null;

export function auditTrailOutcome(run: AuditTrailRun | null | undefined, options?: { contract?: string }): {
  state: AuditTrailState;
  detail: string | null;
  result: AuditTrailResult | null;
};

export function auditTrailGate(input: {
  build: AuditTrailRun | null | undefined;
  check: AuditTrailRun | null | undefined;
  verifiedGit: { gitRoot?: string | null; headSha?: string | null } | null | undefined;
  contract?: string;
}): {
  ready: boolean;
  error: string | null;
  trailer: { head: string | null; root: string | null; artifacts: number | null; path: string | null; contract?: string } | null;
};
