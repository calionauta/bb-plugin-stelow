/**
 * The preflight rule: everything decided before the state is mutated. It syncs
 * scopes, reads the gate, and resolves the route — in that order, because a
 * refusal here is the only chance to refuse without having moved anything. The
 * refusal is recorded on the card's trackable history as well as returned: a
 * stage that did not open needs a reason someone can read later.
 */
import { advanceExecutionGates } from "../lib/build-gates.mjs";
import { isDoneStatus } from "../lib/trackables.mjs";
import { buildRegistry, canStart, dependencyCycles } from "../lib/trackable-relations.mjs";
import { latestSpecTech, loadCardScopes } from "./scopes.js";
import type {
  AdvanceDeps,
  PreparedOrRefusal,
  SyncedScopes,
} from "./execution-advance-types.js";
import type { WorkerCard } from "./workers-types.js";

type PreflightDeps = Pick<AdvanceDeps, "runHelper" | "native" | "reworkNote" | "recordExecutionEntry">;

export type PreflightInput = {
  card: WorkerCard;
  stage: string;
  rootPath: string;
  stateDir: string | null;
  dryRun: boolean;
  includeRework: boolean;
};

export function createAdvancePreflight(deps: PreflightDeps) {
  return {
    prepareAdvance: (input: PreflightInput) => prepareAdvance(deps, input),
  };
}

function recordExecution(
  deps: PreflightDeps,
  cardId: string,
  evidence: string,
  transition: "execution-refused" | "execution-entered",
): void {
  try {
    deps.recordExecutionEntry(cardId, evidence, transition);
  } catch {
    /* the trail never blocks a stage transition */
  }
}

export async function prepareAdvance(
  deps: PreflightDeps,
  input: PreflightInput,
): Promise<PreparedOrRefusal> {
  if (input.dryRun) return { route: null, note: "", evidence: "" };
  if (input.stage !== "execution") return routePreflight(deps, input, "", null);
  const loopNote = input.includeRework ? await deps.reworkNote(input.card) : "";
  const scopes = await syncExecutionScopes(deps, input.card, input.rootPath, input.stateDir);
  if (scopes.refusal) {
    recordExecution(deps, input.card.id, scopes.refusal, "execution-refused");
    return { error: scopes.refusal };
  }
  return routePreflight(deps, input, `${scopes.note}${loopNote}`, scopes.syncedCount);
}

async function routePreflight(
  deps: PreflightDeps,
  input: PreflightInput,
  note: string,
  syncedCount: number | null,
): Promise<PreparedOrRefusal> {
  const route = await deps.native.resolveStageExecutionRoute(input.card, input.stage, input.rootPath);
  if (route?.route.mode === "refused") {
    return { error: route.route.redirect ?? route.route.reason ?? "Execution route refused." };
  }
  const evidence = input.stage === "execution"
    ? `${syncedCount ?? 0} synced scope(s)`
    : "execution preflight passed";
  return { route, note, evidence };
}

/**
 * The scope gate, read after the best-effort sync. A card that is not a build
 * has no scopes to gate, so the sync count is the only thing it learns; a build
 * that cannot start its next scope, or whose scope graph cycles, is refused
 * before the state moves.
 */
async function syncExecutionScopes(
  deps: PreflightDeps,
  card: WorkerCard,
  rootPath: string,
  stateDir: string | null,
): Promise<SyncedScopes> {
  const syncedCount = await bestEffortSync(deps, rootPath, stateDir);
  if (card.kind !== "build") return { syncedCount, refusal: null, note: "" };
  const scopes = loadCardScopes(rootPath, card.id);
  const spec = latestSpecTech(rootPath, card.id)?.content ?? null;
  const registry = buildRegistry(scopes, { defaultKind: "scope" });
  const pending = scopes.filter((scope) => scope.status === "pending");
  const gate = advanceExecutionGates({
    kind: card.kind,
    stage: "execution",
    specContent: spec,
    syncedCount: scopes.length,
    cycles: dependencyCycles(registry),
    hasUnstartablePending: pending.length > 0
      && !pending.some((scope) => canStart(registry, scope.id, isDoneStatus)),
  });
  return { syncedCount, refusal: gate.refusal, note: gateNote(syncedCount, gate.note) };
}

async function bestEffortSync(
  deps: PreflightDeps,
  rootPath: string,
  stateDir: string | null,
): Promise<number | null> {
  try {
    const sync = await deps.runHelper(["sync-scopes", "--json"], rootPath, stateDir ?? undefined);
    const parsed = JSON.parse(sync.stdout || "{}") as { synced?: unknown };
    return typeof parsed.synced === "number" ? parsed.synced : null;
  } catch {
    /* best-effort: the gate below remains authoritative */
    return null;
  }
}

function gateNote(syncedCount: number | null, note: string | null): string {
  const syncNote = syncedCount !== null && syncedCount > 0
    ? `\n(sync-scopes: synced ${syncedCount} scopes)`
    : "";
  return `${syncNote}${note ? `\n(${note})` : ""}`;
}
