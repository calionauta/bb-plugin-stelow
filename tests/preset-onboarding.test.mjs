import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  onboardingInitialState,
  onboardingStepAfterBack,
  onboardingStepAfterNext,
  onboardingTotal,
  persistOnboardingComplete,
  readOnboardingComplete,
} from "../lib/preset-onboarding-state.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const component = readFileSync(join(root, "components/settings/preset-onboarding.tsx"), "utf8");

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

assert.equal(onboardingTotal(false), 2, "tracks without a defaults step have two steps");
assert.equal(onboardingTotal(true), 3, "tracks with a defaults step have three steps");
assert.deepEqual(onboardingInitialState(false, false), { step: 0, singleStep: false, total: 2 }, "first visit starts at the first step");
assert.deepEqual(onboardingInitialState(true, false), { step: 0, singleStep: false, total: 3 }, "a second step does not skip the first step");
assert.deepEqual(onboardingInitialState(true, true), { step: 1, singleStep: true, total: 3 }, "shared completion opens the second step directly");
assert.equal(onboardingStepAfterNext(0, 2), 1, "next reaches the last step");
assert.equal(onboardingStepAfterNext(1, 2), 1, "next cannot pass the last step");
assert.equal(onboardingStepAfterBack(0, 2), 0, "back cannot pass the first step");
assert.equal(onboardingStepAfterBack(1, 2), 0, "back returns to the first step");

const persisted = storage();
assert.equal(readOnboardingComplete(persisted, "track"), false, "a missing track key is not complete");
persistOnboardingComplete(persisted, "track", "shared");
assert.equal(readOnboardingComplete(persisted, "track"), true, "dismissal persists the track key");
assert.equal(readOnboardingComplete(persisted, "shared"), true, "dismissal shares completion with other tracks");

assert.match(
  app,
  /import \{ PresetOnboardingDialog \} from "\.\/components\/settings\/preset-onboarding"/,
  "the app shell consumes the settings onboarding component",
);
assert.doesNotMatch(app, /function PresetOnboardingDialog\(/, "onboarding dialog no longer lives in the app shell");
assert.match(component, /step === total - 1/, "the body selects the last-step contact view");
assert.match(component, /step === 1 && secondBody/, "the body selects the optional defaults step");
assert.match(component, /setStep\(0\)[\s\S]*setSingleStep\(false\)/, "dismissal resets onboarding navigation");
assert.match(component, /STORAGE_KEYS\.onboardPresets/, "dialog storage uses the shared preset-onboarding key");
assert.equal(
  (app.match(/renderPresetManager=\{\(props\) => <PresetManagerDialog \{\.\.\.props\} \/>\}/g) ?? []).length,
  3,
  "all three tracks retain the preset-manager renderer",
);

console.log("preset onboarding test ok: first/last steps, reset, storage, and preset-manager wiring");
