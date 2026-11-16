import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import {
  TrackPanelDialogs,
  EXPLORE_DIALOGS_CONFIG,
  RESEARCH_DIALOGS_CONFIG,
} from "../components/panels/track-panel-dialogs.tsx";
import { BuildPanelDialogs } from "../components/panels/build-panel-dialogs.tsx";
import { analysisPreset } from "../components/panels/build-panel-state.ts";
import { RESEARCH_STRATEGIES } from "../lib/research-strategies.mjs";
import { TECHNIQUE_CATALOG } from "../lib/technique-catalog.mjs";

/**
 * The New-research / New-explore creation dialog, RENDERED end to end through
 * the real TrackPanelDialogs → CreateTrackDialog → StrategyPicker chain.
 *
 * Regression: the loader stores both catalogs under `data.catalog`, but the
 * dialogs read a per-track key (`data.strategies` / `data.stages`). Both were
 * `undefined`, so the picker always received `[]` and the count line sat on
 * "Loading strategies…" forever — the create dialog could not submit because
 * there was nothing to select. Nothing in the suite failed, because the tree
 * test fed the dialog a fixture shaped like the bug.
 *
 * These assertions are on what a person sees: every catalog entry renders as a
 * choice, and the picker never claims to be loading once the data is in.
 */

const PROJECTS = [{ id: "project_1", name: "One" }];
const PRESETS = [{ id: "band-preset", name: "Band preset" }];

function renderDialogs({ catalog, config }) {
  render(h(TrackPanelDialogs, {
    active: true,
    projectId: "project_1",
    data: { projects: PROJECTS, catalog, presets: PRESETS },
    preset: { preset: PRESETS[0], hasBandPreset: true },
    rpc: { call: async () => ({}) },
    createOpen: true,
    presetsOpen: false,
    onCreateOpenChange: () => {},
    onPresetsOpenChange: () => {},
    onOpenPresets: () => {},
    bucketGallery: { openBucketGallery: () => {}, bucketGallery: null },
    onChanged: async () => {},
    renderOnboarding: () => null,
    renderPresetManager: () => null,
    config,
  }));
}

for (const [name, config, catalog, noun, firstLabel] of [
  ["Research", RESEARCH_DIALOGS_CONFIG, RESEARCH_STRATEGIES, "strategies", "Jobs to be done"],
  ["Explore", EXPLORE_DIALOGS_CONFIG, TECHNIQUE_CATALOG, "techniques", "Shape Up proposal"],
]) {
  test(`${name} creation renders the real catalog`, () => {
    renderDialogs({ catalog, config });
    assert.equal(
      screen.queryByText(new RegExp(`Loading ${noun}`, "i")),
      null,
      `${name} never sits on "Loading ${noun}…" once the catalog is loaded`,
    );
    assert.ok(
      screen.queryByText(firstLabel),
      `${name} shows the catalog entry "${firstLabel}" in the picker`,
    );
    assert.equal(
      screen.getAllByRole("radio").length,
      catalog.length,
      `${name} offers every catalog entry as a choice (${catalog.length})`,
    );
    assert.ok(
      screen.queryByText(new RegExp(`^${catalog.length} ${noun}$`)),
      `${name} states the real count instead of a loading placeholder`,
    );
    cleanup();
  });
}

test("an empty catalog never claims to be loading", () => {
  renderDialogs({ catalog: [], config: RESEARCH_DIALOGS_CONFIG });
  // A caught rpc failure leaves the panel with an empty catalog, and the
  // dialog opens against it. "Loading strategies…" there was a lie that made
  // the whole bug invisible.
  assert.equal(screen.queryByText(/Loading/i), null, "no permanent loading claim with no data");
  assert.ok(
    screen.queryByText(/No strategies available/i),
    "an empty catalog says so, and the picker is not silently blank",
  );
  assert.equal(screen.queryAllByRole("radio").length, 0, "and it offers no phantom option");
  cleanup();
});

// Build is the third dialog on the same shell. It has no catalog, but its data
// keys were the same class of risk (`data.boardPresets` / `data.projects` are
// what the loader writes), so the dialog is rendered the same way: the real
// panel dialogs, given the shape the real loader produces.
const BUILD_DATA = {
  boardBandPresets: [{ band: "analysis", presetId: "analysis-preset" }],
  boardPresets: [
    { id: "analysis-preset", name: "Analysis", isDefault: false },
    { id: "default-preset", name: "Default", isDefault: true },
  ],
  cards: [],
  githubAutomationEnabled: true,
  githubStatus: null,
  projects: PROJECTS,
};

test("Build creation renders from the loader's data shape", () => {
  render(h(BuildPanelDialogs, {
    active: true,
    createOpen: true,
    githubOpen: false,
    presetsOpen: false,
    onCreateOpenChange: () => {},
    onGithubOpenChange: () => {},
    onPresetsOpenChange: () => {},
    onOpenPresets: () => {},
    activeProject: { id: "project_1", name: "One" },
    projectId: "project_1",
    data: BUILD_DATA,
    // The panel resolves this through analysisPreset(); a dialog that received
    // null here would silently fall back instead of showing the band preset.
    analysisWorkerPreset: analysisPreset(BUILD_DATA),
    prefs: { quality: "production", explorationCount: "3", redFirst: "strict" },
    reviewGates: [],
    onPrefsChange: () => {},
    onReviewGatesChange: () => {},
    bucketGallery: { openBucketGallery: () => {}, bucketGallery: null },
    rpc: { call: async () => ({}) },
    onChanged: async () => {},
    renderOnboarding: () => null,
    renderPresetManager: () => null,
  }));
  assert.equal(analysisPreset(BUILD_DATA)?.id, "analysis-preset", "the analysis band assignment wins over the board default");
  assert.ok(screen.queryByRole("dialog"), "the New issue dialog opens against the loader's data shape");
  assert.ok(screen.queryByText("Start new issue"), "and it is the creation dialog, not an empty shell");
  assert.ok(
    screen.queryByText(/Analysis phase runs on Analysis/),
    "the analysis band preset reaches the dialog (the preset the panel resolved, not a fallback)",
  );
  assert.equal(screen.queryByText(/Loading/i), null, "Build never renders a loading placeholder either");
  cleanup();
});
