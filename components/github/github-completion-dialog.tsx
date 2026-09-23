import { useLayoutEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * GitHub completion write-back dialog (CardDetailBody trigger).
 *
 * Owns its concern end to end: the close-issue choice, the posting
 * state, and the postGithubCompletion call. The card keeps only the
 * open flag and the trigger. The checkbox resets on every open —
 * write-back stays opt-in per post, never sticky.
 */
export function GithubCompletionDialog({ open, onOpenChange, cardId, issueLabel, onPosted }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  issueLabel: string | null;
  onPosted: () => Promise<void>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [closeIssue, setCloseIssue] = useState(false);
  const [posting, setPosting] = useState(false);
  // Pre-paint so a reopen never flashes the previous choice: write-back
  // stays opt-in per post, exactly like the trigger-side reset it replaces.
  useLayoutEffect(() => {
    if (open) setCloseIssue(false);
  }, [open]);

  async function doPost() {
    setPosting(true);
    try {
      const result = await rpc.call("postGithubCompletion", { cardId, closeIssue });
      if (!result.ok) {
        toast.error(result.error ?? "Could not post to GitHub.");
        // Reload anyway: the comment may have posted even when the close
        // failed, and the card should show the posted state immediately.
        await onPosted();
        return;
      }
      onOpenChange(false);
      toast.success(closeIssue ? "Summary posted and issue closed on GitHub." : "Completion summary posted on GitHub.");
      await onPosted();
    } finally {
      setPosting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share completion summary on GitHub?</DialogTitle>
          <DialogDescription className="space-y-2">
            <p>
              Posts a factual summary (scopes, tasks, prompt) as a comment on {issueLabel ?? "the linked issue"}. Nothing is posted automatically — only this action writes back.
            </p>
          </DialogDescription>
        </DialogHeader>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={closeIssue} onChange={(event) => setCloseIssue(event.target.checked)} />
          <span>Also close the issue on GitHub</span>
        </label>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={posting}>Cancel</Button>
          </DialogClose>
          <Button disabled={posting} onClick={() => void doPost()}>{posting ? "Posting…" : "Post summary"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
