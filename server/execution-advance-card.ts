/**
 * The card-action entry point. Its refusals are ordered by cost: a card that is
 * not there, a card that is archived, a card kind that has no stages at all,
 * then the workspace and the two guards — before any state is touched. Only
 * after the helper has actually advanced the stage does the band swap and the
 * route dispatch happen, so a failed advance leaves the card where it was.
 *
 * This module also owns the two facts both entry points share: which kinds
 * have no stages (NO_STAGE_KINDS) and which status a stage lands in
 * (statusForStage/commitStage). The CLI imports them rather than re-shaping
 * them, so triage-draft vs rest in-progress lives in exactly one place and
 * both paths write stage + status + recordStageEvent together.
 */
import type {
  AdvanceCardResult,
  AdvanceDeps,
  PreparedOrRefusal,
} from "./execution-advance-types.js";
import type { DispatchInput, DispatchResult } from "./execution-advance-dispatch.js";
import type { PreflightInput } from "./execution-advance-preflight.js";
import type { WorkerCard } from "./workers-types.js";

type CardAdvanceDeps = Pick<
  AdvanceDeps,
  | "errors"
  | "getCard"
  | "isArchivedCard"
  | "cardWorkspace"
  | "stateDir"
  | "ensureArtifacts"
  | "questionGate"
  | "runHelper"
  | "updateCard"
  | "recordStageEvent"
  | "publishCard"
  | "requestGatePreReview"
>;

/** The two rules this entry point drives, named rather than re-shaped. */
export type AdvanceServices = {
  prepareAdvance: (input: PreflightInput) => Promise<PreparedOrRefusal>;
  dispatchAdvance: (input: DispatchInput) => Promise<DispatchResult>;
  applyBand: (card: WorkerCard, stage: string, deferred: boolean) => Promise<void>;
};

/** Kinds with no stages at all. Single site: the CLI reuses this guard. */
export const NO_STAGE_KINDS: Record<string, string> = {
  research: "Research cards don't use stages — a completed index moves them to Done automatically.",
  explore: "Explore cards don't use stages — a completed artifact moves them to Done automatically.",
};

/** The refusal for a kind with no stages, or null when the kind advances. */
export function noStageKindRefusal(kind: string): string | null {
  return NO_STAGE_KINDS[kind] ?? null;
}

/** Triage opens as draft; every other stage opens in-progress. Single site. */
export function statusForStage(stage: string): string {
  return stage === "triage" ? "draft" : "in-progress";
}

export type StageCommitDeps = Pick<CardAdvanceDeps, "updateCard" | "recordStageEvent">;

/** One stage/status write: the card row plus its stage-event trail, together. */
export function commitStage(
  deps: StageCommitDeps,
  cardId: string,
  stage: string,
): void {
  deps.updateCard(cardId, {
    stage,
    status: statusForStage(stage),
    activity: "running",
    last_error: null,
  });
  deps.recordStageEvent(cardId, stage);
}

export function createCardAdvance(deps: CardAdvanceDeps, services: AdvanceServices) {
  return {
    advanceCard: (input: { cardId: string; stage: string }) => advanceCard(deps, services, input),
  };
}

export async function advanceCard(
  deps: CardAdvanceDeps,
  services: AdvanceServices,
  { cardId, stage }: { cardId: string; stage: string },
): Promise<AdvanceCardResult> {
  const card = deps.getCard(cardId);
  if (!card) return refuse(deps.errors.cardNotFound);
  if (deps.isArchivedCard(card)) return refuse(deps.errors.cardArchived);
  const kindRefusal = noStageKindRefusal(card.kind);
  if (kindRefusal) return refuse(kindRefusal);
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return refuse(deps.errors.workspaceUnavailable);
  const stateDir = card.dir_hash ? await deps.stateDir(card, workspace.path) : null;
  const guard = await deps.ensureArtifacts(workspace.path, stateDir, Boolean(card.dir_hash));
  if (guard) return refuse(guard);
  const questionGuard = await deps.questionGate(card, stateDir);
  if (questionGuard) return refuse(questionGuard);
  const prepared = await services.prepareAdvance({
    card, stage, rootPath: workspace.path, stateDir, dryRun: false, includeRework: false,
  });
  if ("error" in prepared) return refuse(prepared.error);
  const result = await deps.runHelper(["advance", stage], workspace.path, stateDir ?? undefined);
  if (result.code !== 0) {
    return { ok: false, stdout: result.stdout, error: result.stderr || "stelow advance failed" };
  }
  await services.applyBand(card, stage, false);
  commitStage(deps, cardId, stage);
  const dispatched = await services.dispatchAdvance({
    card, stage, route: prepared.route, note: prepared.note, evidence: prepared.evidence,
  });
  void deps.requestGatePreReview(card.id, stage).catch(() => undefined);
  deps.publishCard(cardId);
  return { ok: true, stdout: result.stdout + dispatched.stdout, error: dispatched.error };
}

function refuse(error: string): AdvanceCardResult {
  return { ok: false, stdout: "", error };
}
