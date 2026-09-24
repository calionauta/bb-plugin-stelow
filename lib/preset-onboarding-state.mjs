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

export function onboardingStepAfterNext(step, total) {
  return Math.min(step + 1, total - 1);
}

export function onboardingStepAfterBack(step) {
  return Math.max(step - 1, 0);
}

export function readOnboardingComplete(storage, storageKey) {
  return storage.getItem(storageKey) === "onboarded";
}

export function persistOnboardingComplete(storage, storageKey, sharedStorageKey) {
  storage.setItem(storageKey, "onboarded");
  storage.setItem(sharedStorageKey, "onboarded");
}
