import { STORAGE_KEYS } from "./panel-storage.mjs";

export function onboardingTotal(hasSecond) {
  return hasSecond ? 3 : 2;
}

export function onboardingInitialState(hasSecond, sharedDone) {
  return {
    step: hasSecond && sharedDone ? 1 : 0,
    singleStep: hasSecond && sharedDone,
    total: onboardingTotal(hasSecond),
  };
}

export function onboardingInitialDialogState({
  active,
  open,
  trackComplete,
  sharedComplete,
  hasSecond,
}) {
  if (!active || open || trackComplete) return null;
  if (sharedComplete && !hasSecond) return null;
  return onboardingInitialState(hasSecond, sharedComplete);
}

export function onboardingStepAfterNext(step, total) {
  return Math.min(step + 1, total - 1);
}

export function onboardingStepAfterBack(step) {
  return Math.max(step - 1, 0);
}

export function readOnboardingComplete(storage, storageKey) {
  return storage.getItem(storageKey) === "onboarded";
}

export function persistOnboarding(storage, storageKey) {
  try {
    storage.setItem(storageKey, "onboarded");
  } catch {
    // Host storage is best-effort; callers still complete their UI action.
  }
}

export function acknowledgeSharedOnboarding(storage, storageKey, onOpenPresets) {
  persistOnboarding(storage, storageKey);
  onOpenPresets();
}

export function persistOnboardingComplete(storage, storageKey, sharedStorageKey) {
  persistOnboarding(storage, storageKey);
  persistOnboarding(storage, sharedStorageKey);
}

export function resetOnboarding(storage) {
  for (const storageKey of [
    STORAGE_KEYS.onboardBuild,
    STORAGE_KEYS.onboardResearch,
    STORAGE_KEYS.onboardExplore,
    STORAGE_KEYS.onboardPresets,
  ]) {
    try {
      storage.removeItem(storageKey);
    } catch {
      // Continue clearing the remaining tracks when one key is blocked.
    }
  }
}
