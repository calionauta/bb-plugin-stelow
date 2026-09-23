import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmActionDialog } from "../manage/confirm-action-dialog";
import type { useBuildDetailLifecycle } from "./use-build-detail-lifecycle";

type BuildLifecycleState = ReturnType<typeof useBuildDetailLifecycle>;

function WorkerConfirmDialogs({ state }: { state: BuildLifecycleState }) {
  return (
    <>
      <ConfirmActionDialog open={state.repairOpen} onOpenChange={state.setRepairOpen} title="Restart with a fresh worker?" description="Reseed state.md and stelow.json so a new worker restarts from the triage stage. Existing scope work and comments are kept. Try Retry first — restart only if the worker itself is broken." confirmLabel="Restart fresh" confirmTone="default" onConfirm={() => void state.doRepair()} />
      <ConfirmActionDialog open={state.restartWorkerOpen} onOpenChange={state.setRestartWorkerOpen} title="Restart the worker on the current preset?" description="Stops the running worker and starts a fresh one on this card's preset, continuing from the current stage (not from triage). Use this to apply a preset change." confirmLabel="Restart worker" confirmTone="default" onConfirm={state.doRestartWorker} />
    </>
  );
}

function RemovalConfirmDialogs({ state }: { state: BuildLifecycleState }) {
  return (
    <>
      <ConfirmActionDialog open={state.archiveOpen} onOpenChange={state.setArchiveOpen} title="Archive this card?" description="Moves this card to Archived. If its worker is active, Stelow stops it. Comments and history are preserved." confirmLabel="Archive card" confirmTone="destructive" onConfirm={state.doArchive} />
      <ConfirmActionDialog open={state.deleteOpen} onOpenChange={state.setDeleteOpen} title="Delete this card permanently?" description="Removes the card, its comments, history, and its Stelow run files (.stelow artifacts) — cannot be recovered. Code changes in Git checkouts are kept: committed and uncommitted work survives the delete." confirmLabel="Delete" confirmTone="destructive" onConfirm={state.doDelete} />
      <ConfirmActionDialog open={state.discardOpen} onOpenChange={state.setDiscardOpen} title={state.discardConfirm?.title ?? "Discard this card’s work?"} description={state.discardConfirm?.body ?? ""} confirmLabel="Discard work" confirmTone="destructive" onConfirm={state.doDiscard} />
      <ConfirmActionDialog open={state.recoveryAttachProjectId !== null} onOpenChange={(open) => { if (!open) state.setRecoveryAttachProjectId(null); }} title="Attach this reported checkout to the audit trail?" description="Stelow will record the reviewed project path, current branch, HEAD, changed-file count, and the worker report. It will not move files, alter the Git index, commit, push, or claim that acceptance tests have passed." confirmLabel="Attach reviewed checkout" confirmTone="default" onConfirm={state.doAttachRecoveryCheckout} />
    </>
  );
}

function PromoteCardDialog({ state, cardDisplayName }: { state: BuildLifecycleState; cardDisplayName: string | null }) {
  return (
    <Dialog open={state.promoteOpen} onOpenChange={state.setPromoteOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turn into project?</DialogTitle>
          <DialogDescription className="space-y-2">
            <p>Files stay in place. To keep one writer for this workflow, Stelow archives the exploratory worker and starts a new worker in the project from the current stage. Open thread then opens that project worker; the earlier thread stays in Worker history.</p>
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Project name</span>
          <Input value={state.promoteName} onChange={(event) => state.setPromoteName(event.target.value)} placeholder={cardDisplayName ?? "Project name"} aria-label="Project name" maxLength={120} />
        </label>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={state.promoting}>Cancel</Button>
          </DialogClose>
          <Button disabled={state.promoting || !state.promoteName.trim()} onClick={() => void state.doPromote()}>{state.promoting ? "Creating…" : "Turn into project"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BuildLifecycleDialogs({ state, cardDisplayName }: { state: BuildLifecycleState; cardDisplayName: string | null }) {
  return (
    <>
      <WorkerConfirmDialogs state={state} />
      <RemovalConfirmDialogs state={state} />
      <PromoteCardDialog state={state} cardDisplayName={cardDisplayName} />
    </>
  );
}
