/**
 * The scope projection the open card renders.
 *
 * Split out of card-detail.ts, which assembles the whole detail picture and had
 * grown past its file budget carrying one more concern. A scope row is not
 * just the scope: it carries its sidecar contract, its conditions, and the live
 * file-claim room it sits in. That last part is why this is its own module — the
 * card's lock surfaces and the scopes it lists have to come from ONE read, and
 * a module that also assembles comments and artifacts is a place where that
 * guarantee quietly stops holding.
 *
 * Every read here is fail-open. A card whose state dir, contract sidecar, or
 * claim registry cannot be read resolves its scopes bare — empty conditions,
 * an unknown claim — because absence of evidence is not evidence of absence,
 * and a detail view that throws is worse than one that says less.
 */

import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { enrichEntriesForDetail } from "../../lib/trackable-evidence.mjs";
import { lapsedScopeClaims, liveClaimsForWorkspace } from "../../lib/card-claims.mjs";
import { workflowStateRelativeDir } from "../../lib/workflow-state-identity.mjs";
import { loadCardScopes, trackingEntryForCard } from "../scopes.js";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
export type CardScope = ReturnType<typeof loadCardScopes>[number];

export type BlockedFile = { file: string; heldBy: string; expiresAt: number };

/** What the card's lock surfaces need from an enriched scope. Narrow on
 * purpose: the enriched row is a record the card renders, and this is the one
 * part the server itself reads back. */
export type ClaimAwareScope = { blockedFiles?: BlockedFile[] | null };

export type EnrichedScope = CardScope & ClaimAwareScope;

/** A scope with every evidence field present but empty — the shape a card with
 * nothing to read still renders, so the panel never branches on presence. */
function bareScope(scope: CardScope): EnrichedScope {
  return {
    ...scope,
    tasks: (Array.isArray(scope.tasks) ? scope.tasks : []).map((task) => ({
      ...task,
      conditions: [],
    })),
    conditions: [],
    claimed: null,
    claimFiles: [],
    blockedFiles: [],
  };
}

export async function enrichScopes(
  deps: { db: Db; bb: BbPluginApi },
  card: WorkerCard,
  workspace: { path: string | null },
  scopes: CardScope[],
): Promise<EnrichedScope[]> {
  // Only Build cards run a scope map; Research and Explore have no state dir to
  // read claims from, which is not the same as a card holding nothing — hence
  // the null claim and the empty lists rather than a guess.
  if (card.kind !== "build" || !workspace.path) return scopes.map(bareScope);
  return enrichBuildScopes(deps, card, workspace.path, scopes);
}

async function enrichBuildScopes(
  deps: { db: Db; bb: BbPluginApi },
  card: WorkerCard,
  sourcePath: string,
  scopes: CardScope[],
): Promise<EnrichedScope[]> {
  const entry = trackingEntryForCard(sourcePath, card.id);
  const stateRel = entry ? workflowStateRelativeDir(entry) : null;
  if (!stateRel) return scopes.map(bareScope);
  const at = Date.now();
  return await enrichEntriesForDetail({
    entries: scopes,
    defaultKind: "scope",
    stateRelDir: stateRel,
    ownerId: card.id,
    liveClaims: readLiveClaims(deps.db, sourcePath),
    isLapsed: (target) => isScopeLapsed(deps.db, card, sourcePath, target, at),
    readContract: (rel) => deps.bb.sdk.files
      .read({ path: join(sourcePath, rel) })
      .then((file) => file.content)
      .catch(() => null),
    nowMs: at,
  });
}

function readLiveClaims(db: Db, sourcePath: string) {
  try {
    return liveClaimsForWorkspace(db, { workspacePath: sourcePath });
  } catch {
    return [];
  }
}

function isScopeLapsed(
  db: Db,
  card: WorkerCard,
  sourcePath: string,
  target: { id?: string; targetFiles?: unknown },
  nowMs: number,
): boolean {
  try {
    const files = Array.isArray(target.targetFiles)
      ? target.targetFiles.filter((file): file is string => typeof file === "string")
      : [];
    return lapsedScopeClaims(db, {
      cardId: card.id,
      workspacePath: sourcePath,
      scope: target.id ?? null,
      files,
      nowMs,
    });
  } catch {
    return false;
  }
}
