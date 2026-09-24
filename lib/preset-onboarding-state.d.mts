export function onboardingTotal(hasSecond: boolean): number;
export function onboardingInitialState(hasSecond: boolean, sharedDone: boolean): {
  step: number;
  singleStep: boolean;
  total: number;
};
export function onboardingStepAfterNext(step: number, total: number): number;
export function onboardingStepAfterBack(step: number): number;
export function readOnboardingComplete(storage: Pick<Storage, "getItem">, storageKey: string): boolean;
export function persistOnboardingComplete(
  storage: Pick<Storage, "setItem">,
  storageKey: string,
  sharedStorageKey: string,
): void;
