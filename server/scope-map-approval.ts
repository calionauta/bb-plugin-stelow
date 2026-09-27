/**
 * Approving a scope map on the host: the one door that makes "approved" real.
 *
 * `lib/scope-map-approval.mjs` owns the shape of an approval (what "approved"
 * means); this module owns the act. It is the only writer of an approved
 * `scope-map.json` in the whole runtime — the worker writes a draft through the
 * recipe, the host stamps it, and nothing else touches it. That division is the
 * point: an approval the worker could write itself would be the same failure the
 * skill's prose delegation produced, where a map that was never approved looked
 * like one that was.
 *
 * Explicit by design. Advancing past the scope stage must never sign a boundary
 * on the human's behalf — a refactor's scopes are the thing being decided, so
 * the stamp is a separate human act, never a side effect of `advance`.
 *
 * Fail-closed everywhere a human meets it: no card, no workspace, no map, an
 * off-contract map, or an already-approved one. Every refusal names the way out.
 */
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { approveScopeMap } from "../lib/scope-map-approval.mjs";
import { recordShapeVersion } from "../lib/scope-map-freshness.mjs";
import { validateScopeMap, type ScopeMap } from "../lib/scope-map.mjs";
import { isArchivedCard } from "../lib/worker-action-policy.mjs";
import type { WorkerCard } from "./workers-types.js";

const SCOPE_MAP_FILE = "scope-map.json";
const STATE_FILE = "state.md";

/**
 * Who a host-side approval is attributed to. BB exposes no human user identity
 * to a plugin — the only `user` row is the machine-auth system account — so a
 * human-triggered approval says "operator": the person at this host, never the
 * agent. If a host ever does expose a caller identity, this is the one constant
 * to replace.
 */
export const OPERATOR_IDENTITY = "operator";

type Workspace = { path: string; hostId: string | null };

export type ScopeMapApprovalDeps = {
  bb: Pick<BbPluginApi, "sdk">;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (rootPath: string, card: WorkerCard) => Promise<string | null>;
  randomId: (prefix: string) => string;
  logCardComment: (
    cardId: string,
    target: string,
    targetId: string,
    author: "user" | "agent",
    body: string,
  ) => void;
  publish: (cardId: string) => void;
  errors: { cardNotFound: string; cardArchived: string; workspaceUnavailable: string };
};

export type ApprovalResult =
  | {
      ok: true;
      receiptId: string;
      approvedBy: string;
      mapId: string;
      shapeVersion: string;
      scopeIds: string[];
    }
  | { ok: false; error: string };

/** The card's owned state dir, or a refusal naming why there is none. */
async function resolveStateDir(
  deps: ScopeMapApprovalDeps,
  card: WorkerCard,
): Promise<{ rootPath: string; stateDir: string } | { error: string }> {
  const workspace = await deps.cardWorkspace(card as never);
  if (!workspace?.path) return { error: deps.errors.workspaceUnavailable };
  const stateDir = card.dir_hash
    ? await deps.workflowStateDir(workspace.path, card as never)
    : null;
  if (!stateDir) {
    return {
      error:
        "This card has no owned workflow state yet. Run the scope stage so the map has somewhere to live.",
    };
  }
  return { rootPath: workspace.path, stateDir };
}

/**
 * The card's scope map as a contract-valid draft, or a refusal.
 *
 * Read and validated directly rather than through the scope-map reader: the
 * reader answers "is there an approvable map?" for the gate and the projection,
 * which need a boolean. The approval door needs the issues to name them — a
 * refusal that lists the exact failing fields is the difference between a human
 * who can fix the map and one who is stuck.
 */
async function readDraftMap(
  deps: ScopeMapApprovalDeps,
  rootPath: string,
  stateDir: string,
): Promise<{ map: ScopeMap } | { error: string }> {
  const content = await deps.bb.sdk.files
    .read({ path: join(stateDir, SCOPE_MAP_FILE) })
    .then((file) => file.content)
    .catch(() => null);
  if (typeof content !== "string") {
    return {
      error:
        "This card has no scope map to approve. The scope stage writes one — run it, then approve here.",
    };
  }
  let draft: unknown;
  try {
    draft = JSON.parse(content);
  } catch {
    return { error: "This scope map is not valid JSON. Rewrite it through the scope stage." };
  }
  const issues = validateScopeMap(draft);
  if (issues.length > 0) {
    return {
      error: `This scope map does not satisfy its contract: ${issues.join("; ")}. Rewrite it through the scope stage, then approve again.`,
    };
  }
  const map = draft as ScopeMap;
  if (map.status === "approved") {
    return {
      error: "This scope map is already approved — approving it again would rewrite who signed it.",
    };
  }
  return { map };
}

/** Stamp the approved map back to disk, refusing a concurrent edit. */
async function writeApprovedMap(
  deps: ScopeMapApprovalDeps,
  rootPath: string,
  stateDir: string,
  map: ScopeMap,
): Promise<{ error?: string }> {
  const write = await deps.bb.sdk.files.write({
    path: join(stateDir, SCOPE_MAP_FILE),
    rootPath,
    expectedSha256: null,
    content: `${JSON.stringify(map, null, 2)}\n`,
  });
  if (write.outcome === "conflict") {
    return {
      error:
        "This scope map changed while it was being approved. Re-read it and approve the current version.",
    };
  }
  return {};
}

/**
 * Mirror the approved map's Shape version into state.md so the X-ray reports a
 * live freshness signal instead of a permanent "unknown". A no-op when the
 * field already agrees.
 */
async function mirrorShapeVersion(
  deps: ScopeMapApprovalDeps,
  rootPath: string,
  stateDir: string,
  shapeVersion: string,
): Promise<void> {
  const statePath = join(stateDir, STATE_FILE);
  const current = await deps.bb.sdk.files
    .read({ path: statePath })
    .then((file) => file.content)
    .catch(() => null);
  const recorded = recordShapeVersion(typeof current === "string" ? current : "", shapeVersion);
  if (recorded.changed) {
    await deps.bb.sdk.files.write({
      path: statePath,
      rootPath,
      expectedSha256: null,
      content: recorded.text,
    });
  }
}

/**
 * Approve the card's scope map, or explain precisely why it cannot be approved.
 */
export async function approveScopeMapOnCard(
  deps: ScopeMapApprovalDeps,
  cardId: string,
): Promise<ApprovalResult> {
  const card = deps.getCard(cardId);
  if (!card) return { ok: false, error: deps.errors.cardNotFound };
  if (isArchivedCard(card as never)) return { ok: false, error: deps.errors.cardArchived };
  const state = await resolveStateDir(deps, card);
  if ("error" in state) return { ok: false, error: state.error };

  const draft = await readDraftMap(deps, state.rootPath, state.stateDir);
  if ("error" in draft) return { ok: false, error: draft.error };

  const receiptId = deps.randomId("receipt");
  const approved = approveScopeMap(draft.map, { receiptId, approvedBy: OPERATOR_IDENTITY });
  if (!approved.ok) {
    // Unreachable: the map already passed validation. Kept so the refusal is a
    // fact about the contract, not a guess.
    return { ok: false, error: approved.reason };
  }
  const stamped = approved.map as ScopeMap;

  const write = await writeApprovedMap(deps, state.rootPath, state.stateDir, stamped);
  if (write.error) return { ok: false, error: write.error };
  await mirrorShapeVersion(deps, state.rootPath, state.stateDir, stamped.shapeVersion);

  const scopeIds = stamped.scopes.map((scope) => scope.id);
  deps.logCardComment(
    cardId,
    "card",
    cardId,
    "user",
    `Scope map approved (${stamped.mapId}) by ${OPERATOR_IDENTITY}: ${scopeIds.join(", ")}. ` +
      `Receipt ${receiptId}. The approved map is immutable for downstream planning; ` +
      `a new boundary or dependency must route through the Scope stage, not an edit.`,
  );
  deps.publish(cardId);
  return {
    ok: true,
    receiptId,
    approvedBy: OPERATOR_IDENTITY,
    mapId: stamped.mapId,
    shapeVersion: stamped.shapeVersion,
    scopeIds,
  };
}
