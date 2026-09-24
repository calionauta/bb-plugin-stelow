import { existsSync, readdirSync } from "node:fs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import {
  hasWorkspaceSource,
  recoveryDisposition,
  recoveryMessage,
  reportedCheckoutPaths,
  reportedRecoveryEvidence,
} from "../lib/workspace-recovery.mjs";
import {
  workspaceRecoveryRpcContract,
  type ProjectSource,
  type RecoveryCandidate,
  type RecoveryCard,
  type RecoveryRow,
  type WorkspaceRecoveryDeps,
} from "./workspaces-recovery-contract.js";
import { createAndRecordAudit } from "./workspaces-recovery-audit.js";

export { workspaceRecoveryRpcContract };
export type {
  RecoveryCard,
  RecoveryGitEvidence,
} from "./workspaces-recovery-contract.js";

export function runWorkspaceRecoveryMigrations(db: WorkspaceRecoveryDeps["db"]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_recoveries (
    card_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    original_workspace_path TEXT,
    evidence TEXT NOT NULL,
    git_root TEXT,
    branch TEXT,
    head_sha TEXT,
    changed_files INTEGER NOT NULL DEFAULT 0,
    attached_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_audits (
    source_card_id TEXT PRIMARY KEY,
    audit_card_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (source_card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (audit_card_id) REFERENCES cards(id) ON DELETE CASCADE
  )`);
}

function exploratoryHasSource(path: string | null): boolean {
  if (!path) return false;
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    return hasWorkspaceSource(entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    })));
  } catch {
    return false;
  }
}

async function findCandidates(
  deps: WorkspaceRecoveryDeps,
  card: RecoveryCard,
  paths: string[],
): Promise<RecoveryCandidate[]> {
  const projects = await deps.listProjects().catch(() => []);
  const candidates: RecoveryCandidate[] = [];
  for (const project of projects) {
    for (const source of project.sources ?? []) {
      if (!source.path || !paths.includes(source.path)) continue;
      if (card.workspace_host_id && source.hostId !== card.workspace_host_id) continue;
      const evidence = await deps.gitEvidence(source.path);
      if (!evidence.isGit || evidence.changedFiles === 0) continue;
      candidates.push({
        projectId: project.id,
        projectName: project.name,
        path: source.path,
        branch: evidence.branch,
        headSha: evidence.headSha,
        changedFiles: evidence.changedFiles,
        evidence: "Worker explicitly reported this registered checkout.",
        gitRoot: evidence.gitRoot,
      });
    }
  }
  return candidates;
}

function recoverySnapshotRows(deps: WorkspaceRecoveryDeps, card: RecoveryCard) {
  const attached = deps.db.prepare(`
    SELECT project_id, project_name, source_path, attached_at
    FROM workspace_recoveries WHERE card_id = ?
  `).get(card.id) as {
    project_id: string;
    project_name: string;
    source_path: string;
    attached_at: number;
  } | undefined;
  const audit = deps.db.prepare(`
    SELECT ra.audit_card_id, ra.created_at, COALESCE(c.display_name, c.name) AS card_name
    FROM recovery_audits ra JOIN cards c ON c.id = ra.audit_card_id
    WHERE ra.source_card_id = ?
  `).get(card.id) as {
    audit_card_id: string;
    created_at: number;
    card_name: string;
  } | undefined;
  return { attached, audit };
}

async function createRecoverySnapshot(deps: WorkspaceRecoveryDeps, card: RecoveryCard) {
  const { attached, audit } = recoverySnapshotRows(deps, card);
  const workspacePath = card.workspace_path;
  const workspace = workspacePath
    ? await deps.gitEvidence(workspacePath)
    : { isGit: false, gitRoot: null, branch: null, headSha: null, changedFiles: 0 };
  const threadOutput = card.worker_thread_id
    ? await deps.getThreadOutput(card.worker_thread_id).catch(() => "")
    : "";
  const paths = reportedCheckoutPaths(card.last_assistant_text ?? "", threadOutput);
  const looseEvidence = reportedRecoveryEvidence(card.last_assistant_text ?? "", threadOutput)
    .filter((entry) => existsSync(entry.path) && !paths.includes(entry.path));
  const candidates = await findCandidates(deps, card, paths);
  const hasSource = exploratoryHasSource(workspacePath);
  const kind = recoveryDisposition({
    workspaceIsGit: workspace.isGit,
    hasWorkspaceSource: hasSource,
    candidates,
    attached: Boolean(attached),
  });
  return {
    kind,
    message: recoveryMessage(kind),
    workspace: { path: workspacePath, isGit: workspace.isGit, hasSource },
    candidates,
    looseEvidence,
    recovery: attached ? {
      projectId: attached.project_id,
      projectName: attached.project_name,
      path: attached.source_path,
      attachedAt: attached.attached_at,
    } : null,
    audit: audit ? {
      cardId: audit.audit_card_id,
      cardName: audit.card_name,
      createdAt: audit.created_at,
    } : null,
  };
}

function emptyRecovery(kind: "documents-only" | "attached", message: string, error: string | null) {
  return {
    kind,
    message,
    workspace: { path: null, isGit: kind === "attached", hasSource: kind === "attached" },
    candidates: [],
    looseEvidence: [],
    recovery: null,
    audit: null,
    error,
  };
}

function recordAttachedRecovery(
  deps: WorkspaceRecoveryDeps,
  card: RecoveryCard,
  candidate: RecoveryCandidate,
): void {
  deps.db.prepare(`
    INSERT OR REPLACE INTO workspace_recoveries
      (card_id, project_id, project_name, source_path, original_workspace_path,
       evidence, git_root, branch, head_sha, changed_files, attached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    card.id,
    candidate.projectId,
    candidate.projectName,
    candidate.path,
    card.workspace_path,
    candidate.evidence,
    candidate.gitRoot,
    candidate.branch,
    candidate.headSha,
    candidate.changedFiles,
    deps.now(),
  );
  const attachmentTrail = [
    `Recovery attached after user review: registered project "${candidate.projectName}" at ${candidate.path};`,
    `${candidate.changedFiles} uncommitted files, branch ${candidate.branch ?? "detached"},`,
    `HEAD ${candidate.headSha?.slice(0, 12) ?? "unknown"}.`,
    "Original exploratory workspace remains preserved.",
  ].join(" ");
  deps.cards.comment(
    card.id,
    "card",
    card.id,
    "agent",
    attachmentTrail,
  );
  deps.publish("card-state", { cardId: card.id });
  deps.publish("board-changed", { cardId: card.id });
}

function findExistingAudit(
  deps: WorkspaceRecoveryDeps,
  cardId: string,
): { auditCardId: string; auditCardName: string } | null {
  const existing = deps.db.prepare("SELECT audit_card_id FROM recovery_audits WHERE source_card_id = ?")
    .get(cardId) as { audit_card_id: string } | undefined;
  if (!existing) return null;
  const auditCard = deps.cards.get(existing.audit_card_id);
  return {
    auditCardId: existing.audit_card_id,
    auditCardName: auditCard?.display_name ?? auditCard?.name ?? "Recovery audit",
  };
}

function readAttachedRecovery(
  deps: WorkspaceRecoveryDeps,
  cardId: string,
): RecoveryRow | undefined {
  return deps.db.prepare(`
    SELECT project_id, project_name, source_path, evidence, git_root,
           branch, head_sha, changed_files
    FROM workspace_recoveries WHERE card_id = ?
  `).get(cardId) as RecoveryRow | undefined;
}

async function attachedProjectSource(
  deps: WorkspaceRecoveryDeps,
  recovery: RecoveryRow,
): Promise<ProjectSource | null> {
  const project = await deps.getProject(recovery.project_id).catch(() => null);
  const source = project?.sources.find((entry) => entry.path === recovery.source_path)
    ?? project?.sources.find((entry) => entry.isDefault)
    ?? project?.sources[0];
  return source?.path === recovery.source_path ? source : null;
}

type RecoverySnapshot = Awaited<ReturnType<typeof createRecoverySnapshot>>;

function workspaceRecoveryHandler(
  deps: WorkspaceRecoveryDeps,
  snapshot: (card: RecoveryCard) => Promise<RecoverySnapshot>,
) {
  return async ({ cardId }: { cardId: string }) => {
    const card = deps.cards.get(cardId);
    if (!card) return emptyRecovery("documents-only", "Card not found.", deps.cardNotFound);
    if (card.workspace_kind !== "exploratory") {
      return emptyRecovery("attached", "This card already belongs to a project workspace.", null);
    }
    return { ...(await snapshot(card)), error: null };
  };
}

function attachRecoveryHandler(
  deps: WorkspaceRecoveryDeps,
  snapshot: (card: RecoveryCard) => Promise<RecoverySnapshot>,
) {
  return async ({ cardId, projectId }: { cardId: string; projectId: string }) => {
    const card = deps.cards.get(cardId);
    if (!card) return { ok: false, error: deps.cardNotFound };
    if (card.workspace_kind !== "exploratory") {
      return { ok: false, error: "This card already belongs to a project workspace." };
    }
    if (isArchivedCard(card)) return { ok: false, error: deps.cardArchived };
    const candidate = (await snapshot(card)).candidates.find((entry) => entry.projectId === projectId);
    if (!candidate) {
      return {
        ok: false,
        error: "That checkout no longer has the exact reported, registered Git evidence. Refresh and review again.",
      };
    }
    recordAttachedRecovery(deps, card, candidate);
    return { ok: true, error: null };
  };
}

function recoveryAuditHandler(deps: WorkspaceRecoveryDeps) {
  return async ({ cardId }: { cardId: string }) => {
    const sourceCard = deps.cards.get(cardId);
    if (!sourceCard) {
      return { ok: false, auditCardId: null, auditCardName: null, error: deps.cardNotFound };
    }
    if (sourceCard.workspace_kind !== "exploratory") {
      return {
        ok: false,
        auditCardId: null,
        auditCardName: null,
        error: "Recovery audits only apply to the preserved exploratory card.",
      };
    }
    const existing = findExistingAudit(deps, cardId);
    if (existing) return { ok: true, ...existing, error: null };
    const recovery = readAttachedRecovery(deps, cardId);
    if (!recovery) {
      return {
        ok: false,
        auditCardId: null,
        auditCardName: null,
        error: "Attach the exact registered checkout first. Recovery never guesses a project or changes files before that review.",
      };
    }
    const source = await attachedProjectSource(deps, recovery);
    if (!source) {
      return {
        ok: false,
        auditCardId: null,
        auditCardName: null,
        error: "The attached project source changed. Re-check recovery evidence before creating its audit card.",
      };
    }
    return createAndRecordAudit(deps, sourceCard, recovery, source);
  };
}

export function createWorkspacesRecovery(deps: WorkspaceRecoveryDeps) {
  const snapshot = (card: RecoveryCard) => createRecoverySnapshot(deps, card);
  return {
    handlers: {
      workspaceRecovery: workspaceRecoveryHandler(deps, snapshot),
      attachRecoveryCheckout: attachRecoveryHandler(deps, snapshot),
      createRecoveryAudit: recoveryAuditHandler(deps),
    },
    snapshot,
  };
}

export async function recoveredCheckoutIntegrity(
  deps: Pick<WorkspaceRecoveryDeps, "db" | "gitEvidence">,
  card: RecoveryCard,
  path: string,
): Promise<string | null> {
  if (card.workspace_kind !== "exploratory") return null;
  const recorded = deps.db.prepare("SELECT git_root FROM workspace_recoveries WHERE card_id = ?")
    .get(card.id) as { git_root: string | null } | undefined;
  if (!recorded?.git_root) return null;
  const live = await deps.gitEvidence(path);
  return !live.isGit || live.gitRoot !== recorded.git_root
    ? "The attached recovery checkout no longer resolves to the Git root you reviewed. Re-check recovery evidence before viewing or acting on this diff."
    : null;
}
