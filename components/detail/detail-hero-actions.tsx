import { Button } from "@/components/ui/button";
import { OpenThreadButton } from "../worker-history/worker-history";
import { HeroErrorNote, type HeroKind } from "./detail-hero";

type HeroActionCard = {
  activity: string;
  status: string;
  workerThreadId: string | null;
  lastError: string | null;
};

type ActionState = {
  starting: boolean;
  retrying: boolean;
  restarting: boolean;
};

type Preset = {
  stale: boolean;
  providerId: string | null;
  modelId: string | null;
};

function StartAction({ card, starting, onStart }: { card: HeroActionCard; starting: boolean; onStart: () => Promise<void> }) {
  if (card.workerThreadId || card.status === "completed" || card.status === "archived") return null;
  return (
    <>
      <span className="w-full text-xs text-muted-foreground">Not started — parked in Bucket. Nothing runs until you start it.</span>
      <Button size="sm" disabled={starting} onClick={() => void onStart()} title="Start a worker for this card now.">{starting ? "Starting…" : "Start"}</Button>
    </>
  );
}

function DecisionActions({ card, heroKind, pending, preset, state, onRetry }: { card: HeroActionCard; heroKind: HeroKind; pending: boolean; preset: Preset; state: ActionState; onRetry: () => Promise<void> }) {
  if (heroKind !== "decision") return null;
  return (
    <>
      {pending ? <span className="w-full text-xs text-muted-foreground">Answer directly below — the first question is open.</span> : null}
      <HeroErrorNote card={card} />
      {card.activity === "error" && card.lastError && !preset.stale ? (
        <Button size="sm" variant="outline" disabled={state.retrying} onClick={() => void onRetry()} title="Retry the failed worker in place instead of answering — nothing is reset.">{state.retrying ? "Retrying…" : "Retry worker"}</Button>
      ) : null}
      {card.workerThreadId ? <OpenThreadButton threadId={card.workerThreadId} /> : null}
    </>
  );
}

function RecoveryButton({ card, label, retryTitle, state, preset, continuation, onRetry, onRestart }: { card: HeroActionCard; label: string; retryTitle: string; state: ActionState; preset: Preset; continuation: string; onRetry: () => Promise<void>; onRestart: () => void }) {
  return (
    <>
      {preset.stale ? <span className="w-full text-xs text-muted-foreground">Preset changed to {preset.providerId}/{preset.modelId} — needs a fresh worker.</span> : null}
      {preset.stale ? (
        <Button size="sm" disabled={state.restarting} onClick={onRestart} title={`Start a fresh worker on the new preset, ${continuation}.`}>{state.restarting ? "Restarting…" : "Restart worker…"}</Button>
      ) : (
        <Button size="sm" disabled={state.retrying} onClick={() => void onRetry()} title={retryTitle}>{state.retrying ? "Retrying…" : label}</Button>
      )}
      {card.workerThreadId ? <OpenThreadButton threadId={card.workerThreadId} /> : null}
    </>
  );
}

function RecoveryActions({ card, heroKind, preset, state, continuation, retryTail, onRetry, onRestart }: { card: HeroActionCard; heroKind: HeroKind; preset: Preset; state: ActionState; continuation: string; retryTail: string; onRetry: () => Promise<void>; onRestart: () => void }) {
  const calmIdle = heroKind === "calm" && card.activity === "idle" && card.workerThreadId != null && card.status !== "completed" && card.status !== "archived";
  if ((heroKind !== "error" && heroKind !== "paused" && !calmIdle) || !card.workerThreadId) return null;
  const label = heroKind === "error" ? "Retry" : heroKind === "paused" && card.lastError ? "Retry" : "Resume";
  const action = heroKind === "paused" && card.lastError
    ? "Retry the failed worker"
    : heroKind === "paused"
      ? "Resume the idle worker"
      : "Continue the same worker";
  const retryTitle = `${action} in place${retryTail} — nothing is reset.`;
  return <RecoveryButton card={card} label={label} retryTitle={retryTitle} state={state} preset={preset} continuation={continuation} onRetry={onRetry} onRestart={onRestart} />;
}

export function DetailHeroActions({ card, heroKind, pending, preset, state, continuation, retryTail = "", extra, onStart, onRetry, onRestart }: { card: HeroActionCard; heroKind: HeroKind; pending: boolean; preset: Preset; state: ActionState; continuation: string; retryTail?: string; extra?: React.ReactNode; onStart: () => Promise<void>; onRetry: () => Promise<void>; onRestart: () => void }) {
  const passiveThread = (heroKind === "working" || heroKind === "calm") && card.workerThreadId && !(heroKind === "calm" && card.activity === "idle" && card.status !== "completed" && card.status !== "archived");
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3">
      <StartAction card={card} starting={state.starting} onStart={onStart} />
      <DecisionActions card={card} heroKind={heroKind} pending={pending} preset={preset} state={state} onRetry={onRetry} />
      <RecoveryActions card={card} heroKind={heroKind} preset={preset} state={state} continuation={continuation} retryTail={retryTail} onRetry={onRetry} onRestart={onRestart} />
      {extra}
      {passiveThread ? <OpenThreadButton threadId={card.workerThreadId!} /> : null}
    </div>
  );
}
