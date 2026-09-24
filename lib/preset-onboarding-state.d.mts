export function onboardingTotal(hasSecond: boolean): number;
export function onboardingInitialState(hasSecond: boolean, sharedDone: boolean): {
  step: number;
  singleStep: boolean;
  total: number;
};
export function onboardingInitialDialogState(input: {
  active: boolean;
  open: boolean;
  trackComplete: boolean;
  sharedComplete: boolean;
  hasSecond: boolean;
}): {
  step: number;
  singleStep: boolean;
  total: number;
} | null;
export function onboardingStepAfterNext(step: number, total: number): number;
export function onboardingStepAfterBack(step: number): number;
export function readOnboardingComplete(storage: Pick<Storage, "getItem">, storageKey: string): boolean;
export function persistOnboarding(
  storage: Pick<Storage, "setItem">,
  storageKey: string,
): void;
export function acknowledgeSharedOnboarding(
  storage: Pick<Storage, "setItem">,
  storageKey: string,
  onOpenPresets: () => void,
): void;
export function persistOnboardingComplete(
  storage: Pick<Storage, "setItem">,
  storageKey: string,
  sharedStorageKey: string,
): void;
export function resetOnboarding(storage: Pick<Storage, "removeItem">): void;
