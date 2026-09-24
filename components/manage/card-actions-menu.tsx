import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { workerActionPolicy } from "../../lib/worker-action-policy.mjs";
import { canReclassifyWorkflow } from "../../lib/workflow-intent-policy.mjs";

// Card manage surface: the actions menu (policy-gated entries that always
// confirm with their blast radius), the reclassify dialog, and outside /
// Escape dismissal with focus return. Destructive entries never run inline.

// Structural view of the card under management: identity, display, type,
// and the lifecycle state the action policy reads. Detail bodies pass
// their full card; assignability keeps the menu honest about what it uses.
export type ManageCardState = {
  id: string;
  intent: string;
  displayName: string | null;
  name: string;
  projectName: string;
  kind: string;
  stage: string;
  activity: string;
  status: string;
  needsAttention: boolean;
};

// Dismiss-anywhere for popovers: an outside press or Escape closes and
// returns focus to the trigger. The close callback should be stable so
// listeners attach once per open.
function useDismissMenu(open: boolean, onClose: () => void) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);
  return { rootRef, triggerRef };
}

// The open menu: reclassify plus the policy-gated destructive entries,
// separated when both families show.
function MenuPopover({ cardId, canReclassify, actions, onPick, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify }: {
  cardId: string;
  canReclassify: boolean;
  actions: { showRestartFresh: boolean; showArchive: boolean; showDiscard: boolean; showDelete: boolean };
  onPick: (action: () => void) => void;
  onRestartFresh: () => void;
  onArchive: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onReclassify: () => void;
}) {
  return (
    <div id={`card-actions-${cardId}`} role="group" aria-label="Card actions" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border bg-popover p-1 text-sm shadow-md">
      {canReclassify ? (
        <button type="button" onClick={() => onPick(onReclassify)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Reclassify workflow…</button>
      ) : null}
      {actions.showRestartFresh ? (
        <button type="button" onClick={() => onPick(onRestartFresh)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left hover:bg-state-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Restart fresh…</button>
      ) : null}
      {(canReclassify || actions.showRestartFresh) && (actions.showArchive || actions.showDiscard || actions.showDelete) ? <div className="my-1 border-t" /> : null}
      {actions.showArchive ? (
        <button type="button" onClick={() => onPick(onArchive)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Archive card…</button>
      ) : null}
      {actions.showDiscard ? (
        <button type="button" onClick={() => onPick(onDiscard)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Discard work…</button>
      ) : null}
      {actions.showDelete ? (
        <button type="button" onClick={() => onPick(onDelete)} className="flex min-h-11 w-full cursor-pointer items-center rounded-sm px-2 text-left text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Delete permanently…</button>
      ) : null}
    </div>
  );
}

// Reclassify dialog: pick a new workflow type and restart from triage.
// Comments and history stay as the record; route, stages, and plan reset.
// The select resets to the card's intent on every open.
function ReclassifyDialog({ open, onOpenChange, intent, onReclassify }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: string;
  onReclassify: (intent: string) => Promise<boolean>;
}) {
  const [nextIntent, setNextIntent] = useState(intent);
  const [reclassifying, setReclassifying] = useState(false);
  // Reset on every open (the menu resets it on the opening click): a
  // cancelled pick never leaks into the next open, and a changed card
  // intent never rewrites a selection mid-dialog.
  useEffect(() => { if (open) setNextIntent(intent); }, [open]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reclassify and restart from triage?</DialogTitle>
          <DialogDescription>
            This starts a fresh worker from triage on the selected workflow type. Existing comments and history stay as the record of the previous attempt; its route, pending stages, and plan are recalculated.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Workflow type</span>
          <select value={nextIntent} onChange={(event) => setNextIntent(event.target.value)} className="h-10 rounded-md border bg-background px-2 text-sm">
            <option value="new-product">New product</option>
            <option value="feature">Feature</option>
            <option value="bugfix">Bug fix</option>
            <option value="refactor">Refactor</option>
            <option value="investigate">Investigate</option>
            <option value="unknown">Unknown intent</option>
          </select>
        </label>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={reclassifying}>Cancel</Button></DialogClose>
          <Button disabled={reclassifying || nextIntent === intent} onClick={() => {
            setReclassifying(true);
            void onReclassify(nextIntent).then((restarted) => { if (restarted) onOpenChange(false); }).finally(() => setReclassifying(false));
          }}>{reclassifying ? "Restarting…" : "Reclassify & restart"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CardActionsMenu({ card, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify }: {
  card: ManageCardState;
  onRestartFresh: () => void;
  onArchive: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onReclassify: (intent: string) => Promise<boolean>;
}) {
  const actions = workerActionPolicy(card, card.needsAttention);
  const [open, setOpen] = useState(false);
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const { rootRef, triggerRef } = useDismissMenu(open, closeMenu);
  const canReclassify = canReclassifyWorkflow(card);
  return (
    <>
      <div ref={rootRef} className="relative shrink-0">
        <Button
          ref={triggerRef}
          size="icon"
          variant="ghost"
          aria-label="Card actions"
          aria-expanded={open}
          aria-controls={`card-actions-${card.id}`}
          title="Card actions"
          onClick={() => setOpen((value) => !value)}
          className="min-h-11 min-w-11"
        >
          <Icon name="MoreHorizontal" className="h-4 w-4" aria-hidden />
        </Button>
        {open ? (
          <MenuPopover
            cardId={card.id}
            canReclassify={canReclassify}
            actions={actions}
            onPick={(action) => { setOpen(false); action(); }}
            onRestartFresh={onRestartFresh}
            onArchive={onArchive}
            onDiscard={onDiscard}
            onDelete={onDelete}
            onReclassify={() => { setOpen(false); setReclassifyOpen(true); }}
          />
        ) : null}
      </div>
      <ReclassifyDialog open={reclassifyOpen} onOpenChange={setReclassifyOpen} intent={card.intent} onReclassify={onReclassify} />
    </>
  );
}
