import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { DetailsDisclosure } from "./disclosure";

// Post-merge nudge: the worktree served its purpose once the PR merged,
// and every idle copy costs disk (its own node_modules especially).
// Suggestive only — removal stays behind an explicit confirm with blast
// radius, and the card is kept as record either way.
export function WorktreeCleanupSuggestion({ cardId, prMerged, onChanged }: { cardId: string; prMerged: boolean; onChanged: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [preview, setPreview] = useState<{ eligible: boolean; confirmTitle: string | null; confirmBody: string | null } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const check = useCallback(async () => {
    if (!prMerged) return;
    try {
      const result = await rpc.call("cleanupWorktreePreview", { cardId });
      setPreview(result.eligible ? { eligible: true, confirmTitle: result.confirmTitle, confirmBody: result.confirmBody } : null);
    } catch {
      setPreview(null);
    }
  }, [rpc, cardId, prMerged]);

  useEffect(() => { void check(); }, [check]);

  async function doCleanup() {
    setConfirmOpen(false);
    try {
      const result = await rpc.call("cleanupWorktree", { cardId });
      if (!result.ok) {
        toast.error(result.error ?? "Cleanup failed.");
        return;
      }
      toast.success(result.summary ?? "Worktree removed.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cleanup failed.");
    }
  }

  if (!prMerged || !preview) return null;
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-sm text-foreground"><span className="font-medium">Merged — this separate copy is now redundant.</span> <span className="text-muted-foreground">Removing it frees disk; the card stays as record.</span></p>
      <DetailsDisclosure summary="What gets removed">
        <ul className="list-disc space-y-1 pl-5">
          <li>The linked worktree folder plus its branch (a technical `git worktree remove`, nothing else).</li>
          <li>Unpushed commits and changed files listed in the confirm step are destroyed with it — merged work is already safe.</li>
          <li>Your main checkout, the card, and its history are untouched.</li>
        </ul>
      </DetailsDisclosure>
      <div>
        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)} title="Remove the redundant worktree after reviewing exactly what goes">Remove worktree…</Button>
      </div>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={preview.confirmTitle ?? "Remove the worktree?"}
        description={preview.confirmBody ?? ""}
        confirmLabel="Remove worktree"
        confirmTone="destructive"
        onConfirm={doCleanup}
      />
    </div>
  );
}
