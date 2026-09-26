import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { AUDIT_TRAIL_FILE, auditTrailOutcome } from "../../lib/audit-trail-contract.mjs";
import { RECON_RECEIPT_FILE, reconReceiptStatus } from "../../lib/recon-receipt.mjs";
import type { WorkerCard } from "../workers-types.js";

type Workspace = { path: string; hostId: string | null };
type AuditDeps = {
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (
    rootPath: string,
    card: WorkerCard,
  ) => Promise<string | null>;
  runHelper: (
    args: string[],
    rootPath: string,
    stateDir: string,
  ) => Promise<{ code: number | null; stdout: string; stderr: string }>;
  errors: { cardNotFound: string; workspaceUnavailable: string };
};

type UnavailableDetail =
  | string
  | "Only Build cards carry an audit trail."
  | "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.";

export function createAuditTrailStatus(deps: AuditDeps) {
  return ({ cardId }: { cardId: string }) => auditTrailStatus(deps, cardId);
}

async function auditTrailStatus(deps: AuditDeps, cardId: string) {
  const card = deps.getCard(cardId);
  if (!card) return unavailable(deps.errors.cardNotFound);
  if (card.kind !== "build") return unavailable("Only Build cards carry an audit trail.");
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path) return unavailable(deps.errors.workspaceUnavailable);
  const stateDir = card.dir_hash
    ? await deps.workflowStateDir(workspace.path, card).catch(() => null)
    : null;
  if (!stateDir) return unavailable(ownershipRefusal());
  const run = await deps.runHelper(
    ["audit-trail", "check", "--strict", "--json"],
    workspace.path,
    stateDir,
  );
  const outcome = auditTrailOutcome(run);
  return {
    state: outcome.state,
    detail: outcome.detail,
    head: snapshotHead(outcome.result),
    path: join(stateDir, AUDIT_TRAIL_FILE),
    contract: contractName(outcome.result),
    recon: await reconStatus(deps, stateDir),
  };
}

function unavailable(detail: UnavailableDetail) {
  return {
    state: "unavailable" as const,
    detail,
    head: null,
    path: null,
    contract: null,
    recon: null,
  };
}

function ownershipRefusal() {
  return "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.";
}

function snapshotHead(result: unknown): string | null {
  const snapshot = (result as { snapshot?: { head?: unknown } } | null)?.snapshot;
  return typeof snapshot?.head === "string" ? snapshot.head : null;
}

function contractName(result: unknown): string | null {
  const contract = (result as { contract?: unknown } | null)?.contract;
  return typeof contract === "string" ? contract : null;
}

async function reconStatus(deps: AuditDeps, stateDir: string) {
  const content = await deps.bb.sdk.files
    .read({ path: join(stateDir, RECON_RECEIPT_FILE) })
    .then((file) => file.content)
    .catch(() => null);
  return reconReceiptStatus(content, stateDir);
}
