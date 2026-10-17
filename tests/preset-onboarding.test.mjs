import assert from "node:assert/strict";
import { loadComponent } from "./helpers/render-component.mjs";
import {
  acknowledgeSharedOnboarding,
  onboardingInitialDialogState,
  onboardingInitialState,
  onboardingStepAfterBack,
  onboardingStepAfterNext,
  onboardingTotal,
  persistOnboardingComplete,
  readOnboardingComplete,
  resetOnboarding,
} from "../lib/preset-onboarding-state.mjs";
import { STORAGE_KEYS } from "../lib/panel-storage.mjs";

// The shell wiring is driven, not read: `renderTrackPanel` is the pure function
// that decides which dialog renderer every track receives, so the wiring is a
// fact about the element it returns rather than about the source text. A run
// without this check is the mutation the old regex guard could not refuse.
const OnboardingStub = () => null;
const ManagerStub = () => null;
const InboxStub = () => null;
const AboutStub = () => null;
const FallbackPanelStub = () => null;
const renderTrackPanel = loadComponent(
  "components/app-support/panel-rendering.tsx",
  "renderTrackPanel",
  {
    "../panels/build-panel": { BuildPanel: FallbackPanelStub },
    "../panels/track-panel": { TrackPanelForKind: FallbackPanelStub },
    "../panels/track-panel-state": { EXPLORE_PANEL_CONFIG: {}, RESEARCH_PANEL_CONFIG: {} },
    "../panels/track-panel-view": { EXPLORE_VIEW_CONFIG: {}, RESEARCH_VIEW_CONFIG: {} },
    "../panels/track-panel-dialogs": { EXPLORE_DIALOGS_CONFIG: {}, RESEARCH_DIALOGS_CONFIG: {} },
    "../panels/inbox-panel": { InboxPanel: InboxStub },
    "../settings/about-panel": { AboutPanel: AboutStub },
    "../settings/preset-onboarding": { PresetOnboardingDialog: OnboardingStub },
    "../settings/preset-manager-shell": { PresetManagerDialog: ManagerStub },
    "../detail/card-detail-route": {
      BareCardRoute: () => null,
      StelowCardDetail: () => null,
      INTENT_LABEL: {},
    },
  },
);
for (const track of ["build", "research", "explore"]) {
  const panel = renderTrackPanel(track, false);
  const onOpen = () => {};
  assert.equal(
    panel.props.renderOnboarding({ open: true, onOpenChange: onOpen, onChanged: onOpen }).type,
    OnboardingStub,
    `${track} renders the onboarding dialog through its track panel`,
  );
  assert.equal(
    panel.props.renderPresetManager({ open: true, onOpenChange: onOpen, onChanged: onOpen }).type,
    ManagerStub,
    `${track} renders the preset manager through its track panel`,
  );
}
assert.equal(renderTrackPanel("inbox", false).type, InboxStub, "the inbox tab keeps its own panel");
assert.equal(renderTrackPanel("unknown", false).type, AboutStub, "an unknown tab falls back to the manage panel");

function storage(failingKey) {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === failingKey) throw new Error("storage blocked");
      values.set(key, value);
    },
    removeItem: (key) => {
      if (key === failingKey) throw new Error("storage blocked");
      values.delete(key);
    },
  };
}

assert.equal(onboardingTotal(false), 2, "tracks without a defaults step have two steps");
assert.equal(onboardingTotal(true), 3, "tracks with a defaults step have three steps");
assert.deepEqual(onboardingInitialState(false, false), { step: 0, singleStep: false, total: 2 }, "first visit starts at the first step");
assert.deepEqual(onboardingInitialState(true, false), { step: 0, singleStep: false, total: 3 }, "a second step does not skip the first step");
assert.deepEqual(onboardingInitialState(true, true), { step: 1, singleStep: true, total: 3 }, "shared completion opens the second step directly");
assert.deepEqual(
  onboardingInitialDialogState({ active: true, open: false, trackComplete: false, sharedComplete: false, hasSecond: false }),
  { step: 0, singleStep: false, total: 2 },
  "an active unacknowledged two-step track opens at the first step",
);
assert.deepEqual(
  onboardingInitialDialogState({ active: true, open: false, trackComplete: false, sharedComplete: true, hasSecond: true }),
  { step: 1, singleStep: true, total: 3 },
  "shared completion opens the defaults step without a counter",
);
assert.equal(
  onboardingInitialDialogState({ active: true, open: false, trackComplete: false, sharedComplete: true, hasSecond: false }),
  null,
  "shared completion suppresses tracks without a defaults step",
);
assert.equal(
  onboardingInitialDialogState({ active: true, open: false, trackComplete: true, sharedComplete: false, hasSecond: true }),
  null,
  "track completion keeps the dialog closed",
);
assert.equal(
  onboardingInitialDialogState({ active: false, open: false, trackComplete: false, sharedComplete: false, hasSecond: true }),
  null,
  "an inactive track keeps the dialog closed",
);
assert.equal(onboardingStepAfterNext(0, 3), 1, "Build next opens the defaults step");
assert.equal(onboardingStepAfterNext(1, 3), 2, "Build next opens the last step");
assert.equal(onboardingStepAfterNext(2, 3), 2, "Build next cannot pass the last step");
assert.equal(onboardingStepAfterBack(2, 3), 1, "Build back returns from the last step");
assert.equal(onboardingStepAfterNext(0, 2), 1, "next reaches the last step");
assert.equal(onboardingStepAfterNext(1, 2), 1, "next cannot pass the last step");
assert.equal(onboardingStepAfterBack(0, 2), 0, "back cannot pass the first step");
assert.equal(onboardingStepAfterBack(1, 2), 0, "back returns to the first step");

const persisted = storage();
assert.equal(readOnboardingComplete(persisted, "track"), false, "a missing track key is not complete");
persistOnboardingComplete(persisted, "track", "shared");
assert.equal(readOnboardingComplete(persisted, "track"), true, "dismissal persists the track key");
assert.equal(readOnboardingComplete(persisted, "shared"), true, "dismissal shares completion with other tracks");

const trackWriteBlocked = storage("track");
assert.doesNotThrow(
  () => persistOnboardingComplete(trackWriteBlocked, "track", "shared"),
  "a blocked track write does not block dismissal",
);
assert.equal(
  readOnboardingComplete(trackWriteBlocked, "shared"),
  true,
  "a blocked track write does not suppress shared completion",
);
const sharedWriteBlocked = storage("shared");
assert.doesNotThrow(
  () => persistOnboardingComplete(sharedWriteBlocked, "track", "shared"),
  "a blocked shared write does not block dismissal",
);
assert.equal(
  readOnboardingComplete(sharedWriteBlocked, "track"),
  true,
  "a blocked shared write preserves track completion",
);

let managerOpened = false;
const managerStorage = storage(STORAGE_KEYS.onboardPresets);
acknowledgeSharedOnboarding(
  managerStorage,
  STORAGE_KEYS.onboardPresets,
  () => { managerOpened = true; },
);
assert.equal(managerOpened, true, "opening preset manager still runs when shared storage is blocked");

const resetStorage = storage();
for (const storageKey of [
  STORAGE_KEYS.onboardBuild,
  STORAGE_KEYS.onboardResearch,
  STORAGE_KEYS.onboardExplore,
  STORAGE_KEYS.onboardPresets,
]) {
  resetStorage.setItem(storageKey, "onboarded");
}
resetOnboarding(resetStorage);
for (const storageKey of [
  STORAGE_KEYS.onboardBuild,
  STORAGE_KEYS.onboardResearch,
  STORAGE_KEYS.onboardExplore,
  STORAGE_KEYS.onboardPresets,
]) {
  assert.equal(resetStorage.getItem(storageKey), null, `reset clears ${storageKey}`);
}

const blockedResetStorage = storage(STORAGE_KEYS.onboardBuild);
for (const storageKey of [
  STORAGE_KEYS.onboardBuild,
  STORAGE_KEYS.onboardResearch,
  STORAGE_KEYS.onboardExplore,
  STORAGE_KEYS.onboardPresets,
]) {
  blockedResetStorage.values.set(storageKey, "onboarded");
}
resetOnboarding(blockedResetStorage);
assert.equal(
  blockedResetStorage.getItem(STORAGE_KEYS.onboardResearch),
  null,
  "one blocked reset does not suppress the remaining tracks",
);

// The dialog's step selection and its shared acknowledgement are driven, not
// read: the component is mounted with a real localStorage, so which body and
// which footer a step shows are facts about a rendered tree rather than about
// a JSX branch a regex guessed at.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => ({ call: async () => ({}) }),
    UrlLink: ({ href, children }) => h("a", { href }, children),
  },
};
register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);
await import("./dom-setup.mjs");
const { createElement: h } = await import("react");
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const { PresetOnboardingDialog } = await import("../components/settings/preset-onboarding.tsx");

function mountDialog({ opened = [], active = true } = {}) {
  window.localStorage.clear();
  render(h(PresetOnboardingDialog, {
    storageKey: STORAGE_KEYS.onboardBuild,
    title: "Choose an agent preset",
    intro: "Presets decide the model each worker runs with.",
    active,
    secondTitle: "Start from a boarding default",
    secondBody: h("p", null, "Quality and supervisor defaults for new cards."),
    onOpenPresets: () => opened.push("presets"),
  }));
  return opened;
}

mountDialog();
assert.ok(screen.getByText("Choose an agent preset"), "the first step is the track's own introduction");
assert.ok(screen.getByText("Step 1 of 3"), "a fresh three-step track counts its steps");
fireEvent.click(screen.getByRole("button", { name: "Next" }));
assert.ok(screen.getByText("Start from a boarding default"), "the optional defaults step has its own title");
assert.ok(screen.getByText("Quality and supervisor defaults for new cards."), "and its own body");
fireEvent.click(screen.getByRole("button", { name: "Next" }));
assert.ok(screen.getByText("Stay in touch"), "the last step is the contact view");
assert.ok(screen.getByRole("button", { name: "Done" }), "and it ends with Done rather than Next");
cleanup();

// Shared completion (another track already onboarded presets) opens the
// defaults step directly and without a counter.
const sharedOpened = [];
window.localStorage.clear();
window.localStorage.setItem(STORAGE_KEYS.onboardPresets, "onboarded");
render(h(PresetOnboardingDialog, {
  storageKey: STORAGE_KEYS.onboardResearch,
  title: "Choose an agent preset",
  intro: "Presets decide the model each worker runs with.",
  active: true,
  secondTitle: "Start from a boarding default",
  secondBody: h("p", null, "Quality and supervisor defaults for new cards."),
  onOpenPresets: () => sharedOpened.push("presets"),
}));
assert.ok(screen.getByText("Start from a boarding default"), "shared completion opens the defaults step directly");
assert.equal(screen.queryByText(/^Step \d/), null, "a shared acknowledgement is not counted as this track's progress");
cleanup();

// Opening Agent Presets acknowledges the SHARED key through the shared helper
// before opening — the binding the panel used to hold as a local name.
const openPresets = mountDialog();
fireEvent.click(screen.getByRole("button", { name: "Open Agent Presets" }));
assert.deepEqual(openPresets, ["presets"], "opening presets still runs the caller's action");
assert.equal(
  window.localStorage.getItem(STORAGE_KEYS.onboardPresets),
  "onboarded",
  "opening presets acknowledges the shared onboarding state through the shared helper, not a second implementation",
);
cleanup();

// A track that already completed keeps the dialog closed.
mountDialog({ active: false });
assert.equal(screen.queryByText("Choose an agent preset"), null, "an inactive track keeps the dialog closed");
cleanup();
// The dismissal navigation reset (step 0, not single-step) is not separately
// observable — the dialog reopens from the lib-derived initial state driven at
// the top of this file — so the pure next/back/initial functions are the
// coverage, and the shell wiring is driven through `renderTrackPanel` above.
// Manage's reset, clicked: the Resources card's confirm clears every track's
// onboarding key through the shared helper, so the control is proved where the
// reader presses it rather than by matching the call inside it.
const { AboutPanel } = await import("../components/settings/about-panel.tsx");
for (const storageKey of [
  STORAGE_KEYS.onboardBuild,
  STORAGE_KEYS.onboardResearch,
  STORAGE_KEYS.onboardExplore,
  STORAGE_KEYS.onboardPresets,
]) {
  window.localStorage.setItem(storageKey, "onboarded");
}
render(h(AboutPanel));
fireEvent.click(screen.getByRole("button", { name: /Reset onboarding/ }));
assert.equal(
  window.localStorage.getItem(STORAGE_KEYS.onboardBuild),
  "onboarded",
  "the first press only asks for confirmation",
);
fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
for (const storageKey of [
  STORAGE_KEYS.onboardBuild,
  STORAGE_KEYS.onboardResearch,
  STORAGE_KEYS.onboardExplore,
  STORAGE_KEYS.onboardPresets,
]) {
  assert.equal(
    window.localStorage.getItem(storageKey),
    null,
    `Manage's confirmed reset clears ${storageKey}`,
  );
}
cleanup();
// The shared acknowledgement helper is bound for the open-presets action, and
// that is now asserted by pressing the button (above) rather than by matching
// the binding: `close` IS the helper only if the shared key moves and the
// caller's action runs.

console.log("preset onboarding test ok: opening cases, navigation, dismissal reset, storage reset, and all manager paths");
