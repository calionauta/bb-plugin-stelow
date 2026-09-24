import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const component = readFileSync(join(root, "components/settings/preset-onboarding.tsx"), "utf8");
const about = readFileSync(join(root, "components/settings/about-panel.tsx"), "utf8");

function sourceBetween(start, end) {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `source contains ${start}`);
  assert.notEqual(endIndex, -1, `source contains ${end}`);
  return app.slice(startIndex, endIndex);
}

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

assert.match(
  app,
  /import \{ PresetOnboardingDialog \} from "\.\/components\/settings\/preset-onboarding"/,
  "the app shell consumes the settings onboarding component",
);
assert.doesNotMatch(app, /function PresetOnboardingDialog\(/, "onboarding dialog no longer lives in the app shell");
assert.match(component, /step === total - 1/, "the body selects the last-step contact view");
assert.match(component, /step === 1 && secondBody/, "the body selects the optional defaults step");
assert.match(component, /setStep\(0\)[\s\S]*setSingleStep\(false\)/, "dismissal resets onboarding navigation");
const onboardingRenderer = /renderOnboarding=\{\(props\) => <PresetOnboardingDialog \{\.\.\.props\} \/>\}/;
const managerRenderer = /renderPresetManager=\{\(props\) => <PresetManagerDialog \{\.\.\.props\} \/>\}/;
for (const [track, nextTrack] of [
  ["build", "research"],
  ["research", "explore"],
  ["explore", "return <AboutPanel"],
]) {
  const endMarker = nextTrack === "return <AboutPanel"
    ? nextTrack
    : `if (tab === "${nextTrack}")`;
  const branch = sourceBetween(`if (tab === "${track}")`, endMarker);
  assert.match(branch, onboardingRenderer, `${track} retains onboarding wiring`);
  assert.match(branch, managerRenderer, `${track} retains preset-manager wiring`);
}
assert.match(
  about,
  /function reset\(\) \{[\s\S]*resetOnboarding\(window\.localStorage\)/,
  "Manage confirms the behavior-tested reset helper",
);
assert.match(
  component,
  /acknowledgeSharedOnboarding\([\s\S]*window\.localStorage,[\s\S]*STORAGE_KEYS\.onboardPresets,[\s\S]*onOpenPresets,[\s\S]*\)/,
  "opening presets uses the behavior-tested shared acknowledgement helper",
);

console.log("preset onboarding test ok: opening cases, navigation, dismissal reset, storage reset, and all manager paths");
