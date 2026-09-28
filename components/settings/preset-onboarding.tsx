import { useEffect, useState, type ReactNode } from "react";
import { STORAGE_KEYS } from "../../lib/panel-storage.mjs";
import {
  onboardingInitialDialogState,
  onboardingStepAfterBack,
  onboardingStepAfterNext,
  onboardingTotal,
  acknowledgeSharedOnboarding,
  persistOnboardingComplete,
  readOnboardingComplete,
} from "../../lib/preset-onboarding-state.mjs";
import { StayInTouchStep } from "../dashboard/stay-in-touch-step";
import { UiDesignMcpCard } from "./ui-design-mcp-card";
import { WorkflowDependencyCard } from "./workflow-dependency-card";
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
  /**
   * Show the optional design-reference offer. Only for tracks that run
   * interface work (Build, Explore) — offering it on a track that never
   * proposes an interface is noise the reader has to dismiss.
   */
  showDesignReference?: boolean;
};

type OnboardingBodyProps = {
  step: number;
  total: number;
  secondBody?: ReactNode;
  children?: ReactNode;
  showDesignReference?: boolean;
};

/** The optional-dependency offers, shown on the steps that introduce them. */
function OptionalOffers({ showDesignReference }: { showDesignReference?: boolean }) {
  return (
    <>
      <WorkflowDependencyCard compact />
      {showDesignReference ? <UiDesignMcpCard /> : null}
    </>
  );
}

function PresetOnboardingBody({ step, total, secondBody, children, showDesignReference }: OnboardingBodyProps) {
  if (step === total - 1) return <StayInTouchStep />;
  if (step === 1 && secondBody) {
    return (
      <div className="grid min-w-0 gap-3">
        <OptionalOffers showDesignReference={showDesignReference} />
        {secondBody}
      </div>
    );
  }
  return (
    <div className="grid gap-3 py-1 text-sm leading-6 text-muted-foreground">
      {step <= 1 ? <OptionalOffers showDesignReference={showDesignReference} /> : null}
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

function PresetOnboardingFooter({ step, total, hasSecond, onOpenPresets, onNext, onBack, onDone }: OnboardingFooterProps) {
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

type OnboardingStateInput = Pick<PresetOnboardingProps, "storageKey" | "active"> & {
  hasSecond: boolean;
};

function usePresetOnboardingState({ storageKey, active, hasSecond }: OnboardingStateInput) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [singleStep, setSingleStep] = useState(false);

  useEffect(() => {
    try {
      const trackComplete = readOnboardingComplete(window.localStorage, storageKey);
      const sharedComplete = readOnboardingComplete(window.localStorage, STORAGE_KEYS.onboardPresets);
      const initial = onboardingInitialDialogState({
        active,
        open,
        trackComplete,
        sharedComplete,
        hasSecond,
      });
      if (!initial) return;
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
    persistOnboardingComplete(window.localStorage, storageKey, STORAGE_KEYS.onboardPresets);
  }

  return {
    open,
    step,
    singleStep,
    dismiss,
    next: () => setStep((current) => onboardingStepAfterNext(current, onboardingTotal(hasSecond))),
    back: () => setStep((current) => onboardingStepAfterBack(current)),
  };
}

/** Title and description for one step — the copy rules live in one place. */
function stepCopy(step: number, lastStep: number, hasSecondTitle: boolean, title: string, secondTitle: string | undefined, intro: string) {
  if (step === lastStep) return { title: "Stay in touch", body: "Feedback and follow-ups." };
  if (step === 1 && secondTitle) return { title: secondTitle, body: "Defaults new cards start from." };
  return { title, body: intro };
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
  showDesignReference,
}: PresetOnboardingProps) {
  const hasSecond = !!secondTitle;
  const total = onboardingTotal(hasSecond);
  const lastStep = total - 1;
  const onboarding = usePresetOnboardingState({ storageKey, active, hasSecond });
  const copy = stepCopy(onboarding.step, lastStep, hasSecond, title, secondTitle, intro);
  const close = acknowledgeSharedOnboarding;

  return (
    <Dialog open={onboarding.open} onOpenChange={(next) => { if (!next) onboarding.dismiss(); }}>
      <DialogContent className={`${hasSecond ? "sm:max-w-2xl" : "sm:max-w-lg"} sm:max-h-[calc(100dvh-1rem)] sm:overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        {!onboarding.singleStep && total > 1 ? (
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Step {onboarding.step + 1} of {total}
          </p>
        ) : null}
        <PresetOnboardingBody
          step={onboarding.step}
          total={total}
          secondBody={secondBody}
          showDesignReference={showDesignReference}
        >{children}</PresetOnboardingBody>
        <DialogFooter>
          <PresetOnboardingFooter
            step={onboarding.step}
            total={total}
            hasSecond={hasSecond}
            onOpenPresets={() => close(window.localStorage, STORAGE_KEYS.onboardPresets, onOpenPresets)}
            onNext={onboarding.next}
            onBack={onboarding.back}
            onDone={onboarding.dismiss}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
