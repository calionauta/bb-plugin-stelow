/**
 * The host surfaces: what the plugin exposes to the IDE and to GitHub.
 *
 * These reach outside the card model — the BB platform (version, update
 * signals, preview sharing), the GitHub issue automation and its schedule,
 * artifact publication, and the `::` mention providers. They are wired
 * together because the scheduler belongs to the feature it drives: disabling
 * the module (STELOW_GITHUB_ISSUES=0) stops the ticks along with the RPCs.
 *
 * This layer sits above the card surfaces because the issue automation it
 * builds needs the card server, and it is the only thing here that does.
 * Nothing else depends on a card existing.
 */
import { createGithubAutomation } from "../../github-issues.js";
import { createArtifactsPublication } from "../../artifacts-publication.js";
import { createPlatformHandlers } from "../platform.js";
import {
  registerAutomationSchedule,
  registerWorkerSkills,
} from "../composition.js";
import { registerMentionProviders } from "../mentions.js";
import { loadCardScopes, normalizeStatus } from "../../scopes.js";
import {
  BUILD_INFO,
  PLUGIN_SKILLS_DIR,
  pluginDir,
  readPinnedStelowVersion,
} from "../../plugin-paths.js";
import { statusLabelForSummary } from "../card-copy.js";
import type { CardSurfaces } from "./card-surfaces.js";
import type { RuntimeCore } from "../runtime-core.js";
import type { GithubAutomation } from "../../github-issues.js";
import type { WorkerCard } from "../../workers-types.js";

export type HostSurfaces = ReturnType<typeof createHostSurfaces>;

export type HostSurfaceDeps = {
  core: RuntimeCore;
  cards: CardSurfaces;
  /** Bind the built automation to the seam the card surfaces read through. */
  github: (automation: GithubAutomation) => void;
};

export function createHostSurfaces(deps: HostSurfaceDeps) {
  const github = buildGithubAutomation(deps);
  registerAutomationSchedule(deps.core.bb, () => github.runAutomationRules());
  registerMentionProviders(deps.core.bb, {
    db: deps.core.db,
    loadBoard: (projectId) => deps.core.loadBoard(deps.core.bb, projectId),
  });
  // Workflow mechanics are private to workers created by the Build panel.
  // Manifest skills are static registrations in BB, so configure() is the
  // boundary that keeps them out of every other thread/session.
  registerWorkerSkills(deps.core.bb);
  return {
    platform: buildPlatform(deps.core),
    github,
    artifactsPublication: buildPublication(deps.core),
  };
}

/** The platform handlers: version, update signal, and preview sharing. */
function buildPlatform(core: RuntimeCore) {
  const { bb, cardPreview, pluginUpdates, previewHost } = core;
  return createPlatformHandlers({
    bb,
    pluginDir,
    pluginSkillsDir: PLUGIN_SKILLS_DIR,
    buildInfo: BUILD_INFO,
    readPinnedStelowVersion,
    refreshPluginUpdate: pluginUpdates.refresh,
    getPluginUpdate: pluginUpdates.getState,
    getGithubRelease: pluginUpdates.getRelease,
    resolveLocalBin: previewHost.resolveLocalBin,
    homeDir: previewHost.homeDir,
    localBinDir: previewHost.localBinDir,
    preview: {
      view: cardPreview.view,
      start: cardPreview.start,
      stop: cardPreview.stop,
      share: cardPreview.share,
    },
  });
}

/** The issue automation: tables, backfills, matcher wiring, scheduler, RPCs. */
function buildGithubAutomation(deps: HostSurfaceDeps) {
  const { core, cards } = deps;
  const { bb, db, now, randomId, getCard, cardWorkspace, presetServer } = core;
  const github = createGithubAutomation({
    db,
    bb,
    now,
    randomId,
    presets: {
      getWorktreePresetId: presetServer.getWorktreePresetId,
      getEffectiveBuildEnvironmentKind:
        presetServer.getEffectiveBuildEnvironmentKind,
      pinCardPreset: presetServer.pinCardPreset,
    },
    cards: {
      get: getCard,
      create: (args) => cards.cards.createInternal(args),
      comment: core.ledger.logCardComment,
      workspace: (card) => cardWorkspace(card as WorkerCard),
      scopes: (card, rootPath) =>
        rootPath ? loadCardScopes(rootPath, card.id) : [],
      normalizeStatus: (value) => normalizeStatus(value),
      statusLabel: (status) => statusLabelForSummary(status),
    },
  });
  deps.github(github);
  return github;
}

/** Publication: turn a merged card into the branch and PR it asked for. */
function buildPublication(core: RuntimeCore) {
  const { bb, db, now, randomId, getCard, seams } = core;
  return createArtifactsPublication({
    db,
    bb,
    now,
    randomId,
    cardNotFound: core.ERRORS.cardNotFound,
    cards: {
      get: getCard,
      checkout: (card) => seams.cardCheckout(card as WorkerCard),
    },
    normalizeStatus,
  });
}
