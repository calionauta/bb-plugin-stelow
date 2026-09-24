import { useEffect, useState, type ReactNode } from "react";
import { STORAGE_KEYS } from "../../lib/panel-storage.mjs";
import {
  onboardingInitialState,
  onboardingStepAfterBack,
  onboardingStepAfterNext,
  onboardingTotal,
  persistOnboardingComplete,
  readOnboardingComplete,
} from "../../lib/preset-onboarding-state.mjs";
import { StayInTouchStep } from "../dashboard/stay-in-touch-step";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export type PresetOnboardingProps = {
  storageKey: string;
  title: string;
  intro: string;
  children?: ReactNode;
  onOpenPresets: () => void;
  active: boolean;
  secondTitle?: string;
  secondBody?: ReactNode;
};

export { onboardingTotal };

type OnboardingBodyProps = {
  step: number;
  total: number;
  secondBody?: ReactNode;
  children?: ReactNode;
};

export function PresetOnboardingBody({ step, total, secondBody, children }: OnboardingBodyProps) {
  if (step === total - 1) return <StayInTouchStep />;
  if (step === 1 && secondBody) return <div className="min-w-0">{secondBody}</div>;
  return (
    <div className="grid gap-3 py-1 text-sm leading-6 text-muted-foreground">
      <p>
        Agent presets decide which provider, model, reasoning, and permission each worker runs with.
        {" "}Each track has its own band default; cards without one fall back to the board default,
        {" "}and any card can pin its own preset in Manage.
      </p>
      {children}
    </div>
  );
}

type OnboardingFooterProps = {
  step: number;
  total: number;
  hasSecond: boolean;
  onOpenPresets: () => void;
  onNext: () => void;
  onBack: () => void;
  onDone: () => void;
};

export function PresetOnboardingFooter({ step, total, hasSecond, onOpenPresets, onNext, onBack, onDone }: OnboardingFooterProps) {
  if (step === total - 1) {
    return (
      <>
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onDone}>Done</Button>
      </>
    );
  }
  if (step === 0) {
    return (
      <>
        <Button variant="outline" onClick={onOpenPresets}>Open Agent Presets</Button>
        {hasSecond || total > 1 ? <Button onClick={onNext}>Next</Button> : <Button onClick={onDone}>Got it</Button>}
      </>
    );
  }
  return (
    <>
      <Button variant="outline" onClick={onBack}>Back</Button>
      <Button onClick={onNext}>Next</Button>
    </>
  );
}

export function PresetOnboardingDialog({
  storageKey,
  title,
  intro,
  children,
  onOpenPresets,
  active,
  secondTitle,
  secondBody,
}: PresetOnboardingProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [singleStep, setSingleStep] = useState(false);
  const hasSecond = !!secondTitle;
  const total = onboardingTotal(hasSecond);
  const lastStep = total - 1;

  useEffect(() => {
    if (!active || open) return;
    try {
      if (readOnboardingComplete(window.localStorage, storageKey)) return;
      const sharedDone = readOnboardingComplete(window.localStorage, STORAGE_KEYS.onboardPresets);
      const initial = onboardingInitialState(hasSecond, sharedDone);
      if (sharedDone && !hasSecond) return;
      setStep(initial.step);
      setSingleStep(initial.singleStep);
      setOpen(true);
    } catch {
      // Host storage is best-effort; a blocked storage API must not block the panel.
    }
  }, [active, open, storageKey, hasSecond]);

  function dismiss() {
    setOpen(false);
    setStep(0);
    setSingleStep(false);
    try {
      persistOnboardingComplete(window.localStorage, storageKey, STORAGE_KEYS.onboardPresets);
    } catch {
      // Dismissal still closes the dialog when storage is unavailable.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className={`${hasSecond ? "sm:max-w-2xl" : "sm:max-w-lg"} sm:max-h-[calc(100dvh-1rem)] sm:overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{step === lastStep ? "Stay in touch" : step === 1 && secondTitle ? secondTitle : title}</DialogTitle>
          <DialogDescription>
            {step === lastStep
              ? "Feedback and follow-ups."
              : step === 1 && secondTitle
                ? "Defaults new cards start from."
                : intro}
          </DialogDescription>
        </DialogHeader>
        {!singleStep && total > 1 ? <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Step {step + 1} of {total}</p> : null}
        <PresetOnboardingBody step={step} total={total} secondBody={secondBody}>{children}</PresetOnboardingBody>
        <DialogFooter>
          <PresetOnboardingFooter
            step={step}
            total={total}
            hasSecond={hasSecond}
            onOpenPresets={() => {
              try { window.localStorage.setItem(STORAGE_KEYS.onboardPresets, "onboarded"); } catch { /* best-effort */ }
              onOpenPresets();
            }}
            onNext={() => setStep((current) => onboardingStepAfterNext(current, total))}
            onBack={() => setStep((current) => onboardingStepAfterBack(current))}
            onDone={dismiss}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

