import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { BuildStatusPills } from "../dashboard/build-status-pills";
import { STAGE_TO_BAND, WORKFLOW_PHASES } from "../../lib/workflow-vocabulary.mjs";
import { canEditWorkflowIntent } from "../../lib/workflow-intent-policy.mjs";
import { CardActionsMenu, type ManageCardState } from "./card-actions-menu";

// Detail header: breadcrumb (project, inline rename, state pills, phase
// rail, intent), the actions menu, and back/close. Rename and intent edit
// own their RPCs; editability stays delegated to the shared policy.

export function PhaseRail({ stage }: { stage: string }) {
  const current = STAGE_TO_BAND[stage] ?? null;
  const known = WORKFLOW_PHASES.some((phase) => phase.id === current);
  return (
    <div aria-label="Workflow phase" className="flex items-center gap-1">
      {WORKFLOW_PHASES.map((phase, index) => (
        <span key={phase.id} className="flex items-center gap-1">
          {index > 0 ? <span aria-hidden className="h-px w-3 bg-muted-foreground/30" /> : null}
          <span title={phase.label} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${known && phase.id === current ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>{phase.label}</span>
        </span>
      ))}
    </div>
  );
}

// Inline rename: pencil swaps the breadcrumb title for an input with
// explicit Save/Cancel — no silent blur-save, the realtime card-state
// publish refreshes every surface after saving.
function RenameControl({ cardId, displayName, name }: { cardId: string | null; displayName: string | null; name: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renamingBusy, setRenamingBusy] = useState(false);
  async function applyRename() {
    if (!cardId || renamingBusy) return;
    setRenamingBusy(true);
    try {
      const result = await rpc.call("renameCard", { cardId, name: draftName });
      if (!result.ok) {
        toast.error(result.error ?? "Could not rename.");
        return;
      }
      setRenaming(false);
    } finally {
      setRenamingBusy(false);
    }
  }
  if (renaming && cardId) {
    return (
      <span className="inline-flex min-w-0 flex-1 items-center gap-1 align-middle">
        <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void applyRename(); if (event.key === "Escape") setRenaming(false); }} aria-label="Card title" maxLength={120} className="h-7 min-w-0 flex-1 text-xs" autoFocus />
        <Button size="sm" variant="outline" disabled={renamingBusy || draftName.trim().length === 0} onClick={() => void applyRename()}>Save</Button>
        <Button size="sm" variant="ghost" disabled={renamingBusy} onClick={() => setRenaming(false)}>Cancel</Button>
      </span>
    );
  }
  return (
    <>
      <span className="font-medium text-foreground">{displayName ?? name ?? "Loading…"}</span>
      {cardId ? (
        <button type="button" onClick={() => { setDraftName(displayName ?? name ?? ""); setRenaming(true); }} title="Rename card" aria-label="Rename card" className="ml-1 inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <Icon name="Edit" className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </>
  );
}

// Intent select: correct the workflow type while triage is open. Failed
// saves toast, never silently keep the old label.
function IntentSelect({ cardId, intent, intentLabel }: { cardId: string; intent: string; intentLabel: (intent: string) => string | undefined }) {
  const rpc = useRpc<typeof rpcContract>();
  async function applyIntent(nextIntent: string) {
    const result = await rpc.call("updateCardIntent", { cardId, intent: nextIntent as "new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown" });
    if (!result.ok) {
      toast.error(result.error ?? "Could not change intent.");
      return;
    }
    toast.success(`Workflow type changed to ${intentLabel(nextIntent) ?? nextIntent}`);
  }
  return (
    <select
      aria-label="Intent"
      title="Workflow type — correct it while this card is still in triage."
      value={intent}
      onChange={(event) => {
        const nextIntent = event.target.value;
        if (nextIntent === intent) return;
        void applyIntent(nextIntent);
      }}
      className="h-6 max-w-32 cursor-pointer truncate rounded-full border border-transparent bg-transparent text-xs font-medium text-muted-foreground hover:border-border hover:text-foreground"
    >
      <option value="new-product">New Product</option>
      <option value="feature">Feature</option>
      <option value="bugfix">Bugfix</option>
      <option value="refactor">Refactor</option>
      <option value="investigate">Investigate</option>
      <option value="unknown">Unknown intent</option>
    </select>
  );
}

// Escape backs out of the card when a back target exists.
function useEscapeBack(onBack?: () => void) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!onBack) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  return { closeRef };
}

export function CardDetailHeader({ card, onBack, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify, statusTone, intentLabel }: {
  card: ManageCardState | null;
  onBack?: () => void;
  onRestartFresh: () => void;
  onArchive: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onReclassify: (intent: string) => Promise<boolean>;
  statusTone: (status: string) => string;
  intentLabel: (intent: string) => string | undefined;
}) {
  const { closeRef } = useEscapeBack(onBack);
  return (
    <header className="flex items-center gap-2 border-b bg-card/80 px-3 py-1.5">
      {onBack ? <button onClick={onBack} title="Back to board (Esc)" className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md bg-background px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
        <span aria-hidden>←</span>
        <span>Board</span>
      </button> : null}
      <nav className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-label="Breadcrumb">
        <span>Stelow</span>
        <span aria-hidden className="mx-1 text-border">/</span>
        <span className="font-medium">{card?.projectName ?? "…"}</span>
        <span aria-hidden className="mx-1 text-border">/</span>
        <RenameControl cardId={card?.id ?? null} displayName={card?.displayName ?? null} name={card?.name ?? null} />
        {card ? <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 align-middle"><BuildStatusPills card={card} statusTone={statusTone} intentLabel={intentLabel} /></span> : null}
        {card && card.kind === "build" ? <span className="ml-2 hidden align-middle md:inline-flex"><PhaseRail stage={card.stage} /></span> : null}
      </nav>
      {card ? <>
        {card.kind === "build" && canEditWorkflowIntent(card) ? (
        <IntentSelect cardId={card.id} intent={card.intent} intentLabel={intentLabel} />
        ) : null}
        <CardActionsMenu card={card} onRestartFresh={onRestartFresh} onArchive={onArchive} onDiscard={onDiscard} onDelete={onDelete} onReclassify={onReclassify} />
      </> : null}
      {onBack ? <button ref={closeRef} onClick={onBack} title="Close (Esc)" aria-label="Close card details" className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <Icon name="X" className="h-4 w-4" aria-hidden />
      </button> : null}
    </header>
  );
}
