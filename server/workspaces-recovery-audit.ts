import type {
  AuditCardInput,
  ProjectSource,
  RecoveryCard,
  RecoveryRow,
  WorkspaceRecoveryDeps,
} from "./workspaces-recovery-contract.js";

function auditPrompt(sourceCard: RecoveryCard, recovery: RecoveryRow): string {
  const evidence = [
    `Recorded Git root: ${recovery.git_root ?? "unknown"};`,
    `branch: ${recovery.branch ?? "detached"};`,
    `HEAD: ${recovery.head_sha ?? "unknown"};`,
    `changed files at review: ${recovery.changed_files}.`,
  ].join(" ");
  const instructions = [
    "Inspect the existing uncommitted changes and the original card's artifacts before editing.",
    "Do not rewrite or complete the original exploratory card.",
    "Establish what is recoverable, make only justified fixes in this real project workspace,",
    "run the host-recorded test check, and use the normal Git changes / PR workflow for any publication.",
  ].join(" ");
  return [
    `Recovery audit for the preserved exploratory card “${sourceCard.display_name ?? sourceCard.name}”.`,
    `Evidence source: ${recovery.source_path}`,
    evidence,
    instructions,
  ].join("\n\n");
}

function auditCardInput(
  recovery: RecoveryRow,
  source: ProjectSource,
  sourceCard: RecoveryCard,
): AuditCardInput {
  return {
    projectId: recovery.project_id,
    environment: {
      type: "host",
      hostId: source.hostId,
      workspace: { type: "unmanaged", path: source.path },
    },
    prompt: auditPrompt(sourceCard, recovery),
    attachments: [],
    intent: "investigate",
    appetite: "Complete",
    reviewMode: "Product Spec + Interface + Tech Review + Code Diff",
    kind: "build",
    start: true,
  };
}

function recordAudit(
  deps: WorkspaceRecoveryDeps,
  sourceCard: RecoveryCard,
  recovery: RecoveryRow,
  auditCardId: string,
): void {
  deps.db.prepare("INSERT INTO recovery_audits (source_card_id, audit_card_id, created_at) VALUES (?, ?, ?)")
    .run(sourceCard.id, auditCardId, deps.now());
  const mismatchTrail = [
    "Recovery mismatch recorded. Original exploratory work remains immutable;",
    `recovery audit card ${auditCardId} now owns review, tests, commits, and PRs for ${recovery.project_name}.`,
  ].join(" ");
  deps.cards.comment(
    sourceCard.id,
    "card",
    sourceCard.id,
    "agent",
    mismatchTrail,
  );
  deps.cards.comment(
    auditCardId,
    "card",
    auditCardId,
    "agent",
    `Recovery audit created from preserved card ${sourceCard.id}. Evidence checkout: ${recovery.source_path}; recorded HEAD ${recovery.head_sha ?? "unknown"}.`,
  );
  deps.publish("card-state", { cardId: sourceCard.id });
  deps.publish("card-state", { cardId: auditCardId });
  deps.publish("board-changed", { cardId: auditCardId });
}

export async function createAndRecordAudit(
  deps: WorkspaceRecoveryDeps,
  sourceCard: RecoveryCard,
  recovery: RecoveryRow,
  source: ProjectSource,
) {
  try {
    const created = await deps.cards.create(auditCardInput(recovery, source, sourceCard));
    const auditCard = deps.cards.get(created.cardId);
    recordAudit(deps, sourceCard, recovery, created.cardId);
    return {
      ok: true,
      auditCardId: created.cardId,
      auditCardName: auditCard?.display_name ?? auditCard?.name ?? "Recovery audit",
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      auditCardId: null,
      auditCardName: null,
      error: error instanceof Error ? error.message : "Could not create the recovery audit card.",
    };
  }
}
