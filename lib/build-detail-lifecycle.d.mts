export type BuildLifecycleAction =
  | "archive"
  | "delete"
  | "discard"
  | "promote"
  | "attach-recovery"
  | "create-recovery-audit"
  | "repair"
  | "retry"
  | "restart"
  | "start"
  | "split";

export type BuildLifecycleOutcome = {
  ok: boolean;
  success?: string;
  error?: string;
  close?: boolean;
  refresh?: boolean;
  refreshRecovery?: boolean;
  auditCardId?: string;
};

export function buildLifecycleOutcome(
  action: BuildLifecycleAction,
  result: Record<string, unknown>,
  context?: { intent?: string; intentLabels?: Record<string, string> },
): BuildLifecycleOutcome;

export function buildDiscardConfirmation(preview: {
  eligible: boolean;
  reason?: string | null;
  confirmTitle?: string | null;
  confirmBody?: string | null;
}):
  | { eligible: false; error: string }
  | { eligible: true; confirmation: { title: string; body: string } };
