export type ScopeProgressInput = {
  name?: string;
  status?: string | null;
  tasks?: Array<{ name?: string; status?: string | null }> | null;
} | null;

export type ScopeProgressSummary = {
  scopes: { done: number; total: number; percent: number };
  tasks: { done: number; total: number; percent: number };
  doingNames: string[];
  doingCount: number;
  blockedNames: string[];
  allComplete: boolean;
};

export function summarizeScopeProgress(scopes: ScopeProgressInput[] | null | undefined): ScopeProgressSummary;

export type GapSummaryInput = {
  matched: boolean;
  escalated: number;
  unscoped: number;
  pendingScopes: number;
  done: boolean;
};

export function gapSummaryPresentation(summary: GapSummaryInput | null | undefined): {
  blocked: boolean;
  waitCopy: string | null;
  resolvedCopy: string | null;
} | null;

export type QualitySealInput = {
  status: string;
  failures?: string[] | null;
  label?: string | null;
} | null;

export function qualitySealPresentation(seal: QualitySealInput, path: string): {
  text: string;
  icon: string;
  tone: string;
  title?: string;
};
