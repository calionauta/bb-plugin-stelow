import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { AUDIT_TRAIL_FILE, auditTrailGate, auditTrailOutcome } from "../../lib/audit-trail-contract.mjs";
import { RECON_RECEIPT_FILE, reconReceiptStatus } from "../../lib/recon-receipt.mjs";
import { OWNERSHIP_UNVERIFIED } from "../../lib/ownership-refusal.mjs";
import type { WorkerCard } from "../workers-types.js";
import type { CliDeps, GitEvidence } from "./cli/cli-deps.js";

type CompletionAuditDeps = Pick<CliDeps, "runHelper" | "gitEvidence">;

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

/** Why the trail could not be read. Plain `string` rather than a union of the
 * sentences that reach it: the two callers are a card that is not a Build card
 * and an ownership refusal, and the second now comes from one shared constant
 * anyway. A union here was a second list to forget when the words changed. */
type UnavailableDetail = string;

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
  if (!stateDir) return unavailable(OWNERSHIP_UNVERIFIED);
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

/**
 * Completion refuses when the trail does not validate, not when the helper is
 * merely old. The build/check pair must agree before the gate binds the trail
 * to the repository the receipt verified.
 */
export async function auditTrailRefusal(
  deps: CompletionAuditDeps,
  projectPath: string | null,
  stateDir: string | null,
  git: GitEvidence,
): Promise<string | null> {
  if (!projectPath) return null;
  const trail = await deps.runHelper(
    ["audit-trail", "build", "--strict", "--json"],
    projectPath,
    stateDir ?? undefined,
  );
  const trailCheck =
    trail.code === 0
      ? await deps.runHelper(
          ["audit-trail", "check", "--strict", "--json"],
          projectPath,
          stateDir ?? undefined,
        )
      : null;
  const snapshotCommonDir = await snapshotRepository(deps, trailCheck ?? trail);
  const gate = auditTrailGate({
    build: trail,
    check: trailCheck,
    verifiedGit: git,
    snapshotCommonDir,
  });
  if (gate.ready) return null;
  return gate.error ?? "Audit trail validation failed.";
}

/**
 * The repository the trail's snapshot names, resolved on this machine.
 *
 * The vendored helper reports the root it sampled but not the repository
 * identity. The host can read the identity from that root, rather than wait
 * for an upstream helper release before the gate can work.
 */
export async function snapshotRepository(
  deps: Pick<CompletionAuditDeps, "runHelper" | "gitEvidence">,
  run: Awaited<ReturnType<CompletionAuditDeps["runHelper"]>> | null,
): Promise<string | null> {
  if (!run || run.code !== 0) return null;
  const root = auditTrailOutcome(run)?.result?.snapshot?.root;
  if (typeof root !== "string" || !root) return null;
  const evidence = await deps.gitEvidence(root).catch(() => null);
  return evidence?.commonDir ?? null;
}
