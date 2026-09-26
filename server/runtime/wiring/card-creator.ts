/**
 * The card creation config.
 *
 * A card is seeded with the protocol text its worker must follow and the
 * track it runs on. Both live in owner modules — the protocol clauses, the
 * track capabilities, the seeding helper, the worker prompts — so this is
 * wiring, not content: it decides what a new card is made of, and nothing
 * here explains or paraphrases a rule.
 */
import { roundTimestamp } from "../../../lib/research-rounds.mjs";
import { isManagedWorktreeEnvironment } from "../../../lib/card-environment.mjs";
import { createCardsServer } from "../../cards.js";
import type { PresetRow } from "../../presets.js";
import {
  type ExploreWorkerPromptInput,
  type ResearchWorkerPromptInput,
} from "../track-prompts.js";
import { seedWorkflow } from "../workflow-seeding.js";
import {
  CARD_OWNER_RULES,
  CLI_EQUIVALENTS,
  COMMIT_STYLE,
  DONE_PROTOCOL,
  DRAFT_PROTOCOL,
  INTERFACE_PICK,
  NEVER_SEED,
  RECON_PROTOCOL,
  SPLIT_PROTOCOL,
  TURN_DISCIPLINE,
} from "../plugin-protocols.js";
import type { RuntimeCore } from "../runtime-core.js";

/** The protocol clauses every new card's worker is told to follow. */
const CARD_CREATOR_RULES = {
  cardOwnerRules: CARD_OWNER_RULES,
  neverSeed: NEVER_SEED,
  cliEquivalents: CLI_EQUIVALENTS,
  reconProtocol: RECON_PROTOCOL,
  draftProtocol: DRAFT_PROTOCOL,
  turnDiscipline: TURN_DISCIPLINE,
  commitStyle: COMMIT_STYLE,
  interfacePick: INTERFACE_PICK,
  doneProtocol: DONE_PROTOCOL,
  splitProtocol: SPLIT_PROTOCOL,
} as const;

/**
 * The worker prompt each new card is spawned with. The prompt builders take
 * the full input row, which the card server assembles from a narrower shape,
 * so the narrowing is stated once here rather than at both call sites.
 */
function trackPrompts(prompts: RuntimeCore["prompts"]) {
  return {
    researchPrompt: (input: Record<string, unknown>) =>
      prompts.researchWorkerPrompt(
        input as unknown as ResearchWorkerPromptInput,
      ),
    explorePrompt: (input: Record<string, unknown>) =>
      prompts.exploreWorkerPrompt(
        input as unknown as ExploreWorkerPromptInput,
      ),
  };
}

/** The card creation config, typed by the one consumer that reads it. */
type CardCreatorConfig = Parameters<typeof createCardsServer>[0]["create"];

export function createCardCreator(core: RuntimeCore): CardCreatorConfig {
  const { bb, db, now, randomId, presetServer, workers, seams } = core;
  const { prompts, trackCapabilities, roundRelPath, roundFileName } = core;
  return {
    db,
    bb,
    now,
    randomId,
    roundTimestamp,
    seedBuildIntent: core.decision.seedBuildIntent,
    seedWorkflow,
    researchStrategy: trackCapabilities.researchStrategy,
    exploreStage: trackCapabilities.exploreStage,
    researchIds: trackCapabilities.researchIds,
    exploreIds: trackCapabilities.exploreIds,
    defaultPreset: presetServer.getDefaultPreset,
    getPreset: presetServer.getPresetById,
    getBandPresetId: presetServer.getBandPresetId,
    getReliablePresetId: presetServer.getReliablePresetId,
    createCardOverride: (cardId, base, override) =>
      presetServer.createCardOverride(cardId, base as PresetRow, override),
    pinCardPreset: presetServer.pinCardPreset,
    removeCardPreset: presetServer.removeCardPreset,
    presetParams: (preset) =>
      presetServer.presetAttachmentParams(preset as PresetRow),
    spawnInitial: (args) => workers.spawnInitial(args),
    recordThread: (cardId, threadId, presetId, reason) =>
      workers.recordThread(cardId, threadId, presetId, reason),
    lineage: (rootPath, dirHash, threadId, presetId, reason) =>
      workers.lineage(rootPath, dirHash, threadId, presetId, reason),
    roundPath: roundRelPath,
    roundFile: roundFileName,
    ensureParent: seams.ensureArtifactParent,
    ...trackPrompts(prompts),
    rules: CARD_CREATOR_RULES,
    describeManagedWorktree: isManagedWorktreeEnvironment,
    recordStageEvent: core.ledger.recordStageEvent,
    comment: (cardId, body) => {
      core.ledger.logCardComment(cardId, "card", cardId, "agent", body);
    },
    suggestCardName: (cardId) => core.drafting.suggestCardName(cardId),
  };
}
