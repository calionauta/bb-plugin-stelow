/**
 * The services every surface shares: the card store, the preset server, the
 * inbox, and the two card writers built on top of them.
 *
 * These are constructed once and reached for by name, which is what keeps a
 * card's "not found", "archived", and "workspace unavailable" refusals — and
 * its preset resolution — identical on every surface that reports them.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import type { PresetRow } from "../presets.js";
import { createPresetJudgeRunner } from "../decisions/preset-judge-runner.js";
import { createArtifactCriteriaJudge } from "../decisions/artifact-criteria-judge.js";
import { createScoredBatchJudge } from "../decisions/scored-batch-judge.js";
import { createCoreDependencies } from "./composition.js";
import { createCardUpdater, createClaimWaiterNotifier } from "./card-state.js";
import { ERRORS } from "./card-errors.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type RuntimeServiceDeps = {
  bb: BbPluginApi;
  db: Db;
  now: () => number;
  randomId: (prefix: string) => string;
};

/** The two writers every surface mutates cards through. */
function createCardWriters(
  deps: RuntimeServiceDeps,
  core: ReturnType<typeof createCoreDependencies>,
) {
  return {
    updateCard: createCardUpdater({
      db: deps.db,
      bb: deps.bb,
      now: deps.now,
      getCard: core.cardStore.getCard,
      recordInbox: core.inbox.record,
      resolveInbox: core.inbox.resolve,
    }),
    notifyClaimWaiters: createClaimWaiterNotifier({
      db: deps.db,
      bb: deps.bb,
      now: deps.now,
      getCard: core.cardStore.getCard,
      resolveInbox: core.inbox.resolve,
    }),
  };
}

/**
 * The preset judges. One runner feeds all three entry points — a criteria
 * judge and a scored-batch judge are the same runner with a different rubric
 * — so they cannot drift into two different preset call shapes.
 */
function createJudges(
  bb: BbPluginApi,
  getPresetById: (id: string) => PresetRow | null,
) {
  const judgeViaPreset = createPresetJudgeRunner({ bb, getPresetById });
  return {
    judgeViaPreset,
    judgePresetCriteria: createArtifactCriteriaJudge(judgeViaPreset),
    judgeScoredBatch: createScoredBatchJudge(judgeViaPreset),
  };
}

export function createRuntimeServices(deps: RuntimeServiceDeps) {
  const core = createCoreDependencies(deps);
  const { cardStore, presetServer, inbox } = core;
  const writers = createCardWriters(deps, core);
  return {
    cardStore,
    presetServer,
    inbox,
    getCard: cardStore.getCard,
    cardWorkspace: cardStore.cardWorkspace,
    recordInboxEvent: inbox.record,
    resolveInboxEvents: inbox.resolve,
    markInboxQuestionsAnswered: (
      cardId: string,
      interactionIds: string[],
    ) => inbox.markAnswered(cardId, interactionIds),
    syncPendingQuestionInbox: (
      card: { id: string },
      interactionIds: string[],
      occurredAt = deps.now(),
    ) => inbox.syncPendingQuestion(card.id, interactionIds, occurredAt),
    presetParams: (preset: unknown) =>
      presetServer.presetAttachmentParams(preset as PresetRow),
    ...writers,
    ...createJudges(deps.bb, presetServer.getPresetById),
    ERRORS,
  };
}

export type RuntimeServices = ReturnType<typeof createRuntimeServices>;
