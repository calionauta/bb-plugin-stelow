import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
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
import { runPublicationMutation } from "../../lib/publication-mutation.mjs";
import type { rpcContract } from "../../server";

export type PublicationAction =
  | "commit"
  | "squash"
  | "push"
  | "sync"
  | "ready"
  | "draft"
  | "merge";

type MergeMethod = "merge" | "rebase" | "squash";

type PublicationActionsProps = {
  cardId: string;
  action: PublicationAction | null;
  setAction: (action: PublicationAction | null) => void;
  publicationDefaultBranch: string | null;
  publishesToDefaultBranch: boolean;
  behind: number;
  mergeMethod: MergeMethod;
  loadPublication: () => Promise<void>;
  loadPushTerminals: () => Promise<void>;
  schedulePushRefresh: (action: PublicationAction) => void;
  onChanged: () => void | Promise<void>;
};

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type ActionContext = Omit<PublicationActionsProps, "action" | "setAction"> & { rpc: Rpc };

function showResult(result: { ok: boolean; message: string }, success?: string) {
  if (!result.ok) toast.error(result.message);
  else toast.success(success ?? result.message);
}

async function executeAction(
  action: PublicationAction,
  context: ActionContext,
) {
  const { cardId, mergeMethod, loadPushTerminals, schedulePushRefresh } = context;
  if (action === "commit") {
    const result = await context.rpc.call("publicationCommit", { cardId });
    showResult(
      result,
      result.commitSha ? `Committed ${result.commitSha.slice(0, 7)}.` : undefined,
    );
  } else if (action === "squash") {
    const result = await context.rpc.call("publicationSquashMerge", { cardId });
    showResult(
      result,
      result.commitSha
        ? `Squash merged as ${result.commitSha.slice(0, 7)}.`
        : undefined,
    );
  } else if (action === "push" || action === "sync") {
    const result = action === "push"
      ? await context.rpc.call("publicationPushTerminal", { cardId })
      : await context.rpc.call("publicationPullPush", { cardId });
    showResult(result);
    await loadPushTerminals();
    schedulePushRefresh(action);
  } else {
    const result = await context.rpc.call("publicationPullRequestAction", {
      cardId,
      operation: action,
      ...(action === "merge" ? { method: mergeMethod } : {}),
    });
    showResult(result);
  }
}

function actionTitle(props: Pick<
  PublicationActionsProps,
  "action" | "publishesToDefaultBranch" | "publicationDefaultBranch"
>) {
  const { action, publicationDefaultBranch, publishesToDefaultBranch } = props;
  if (action === "commit") {
    return publishesToDefaultBranch
      ? `Save a local commit to ${publicationDefaultBranch}?`
      : "Commit this workspace?";
  }
  if (action === "squash") return "Squash this branch into its local base?";
  if (action === "push") return "Push this branch now?";
  if (action === "sync") return "Sync & push now?";
  if (action === "ready") return "Mark this pull request ready?";
  if (action === "draft") return "Convert this pull request to draft?";
  return "Merge this pull request?";
}

function CommitDescription(props: Pick<
  PublicationActionsProps,
  "publishesToDefaultBranch" | "publicationDefaultBranch"
>) {
  if (!props.publishesToDefaultBranch) {
    return (
      <p>
        BB will commit the current changes on the card&apos;s workspace host. This is
        manual and will use BB&apos;s configured Git identity and hooks.
      </p>
    );
  }
  return (
    <p>
      BB will create a local commit on <code>{props.publicationDefaultBranch}</code> in
      the card&apos;s selected checkout. It will not fetch remote updates, merge incoming
      changes, push, or create a pull request. This bypasses a pull request, so continue
      only when the checkout is current and direct commits are intended.
    </p>
  );
}

function PushDescription({ behind }: Pick<PublicationActionsProps, "behind">) {
  return (
    <>
      <p>
        This panel will run <code>git push</code> in this card&apos;s worker checkout and
        stream the output into Push shells below — nothing hides in a sidebar you have
        to hunt. Rejections and auth prompts appear there; an auth prompt is finished
        in BB&apos;s sidebar terminal.
      </p>
      {behind > 0 ? (
        <p>
          This branch is {behind} behind — a push will be rejected. Cancel and use Sync
          &amp; push instead: it pulls with rebase, then pushes.
        </p>
      ) : null}
    </>
  );
}

function ActionDescription(props: Pick<
  PublicationActionsProps,
  "action" | "publishesToDefaultBranch" | "publicationDefaultBranch" | "behind" | "mergeMethod"
>) {
  if (props.action === "commit") return <CommitDescription {...props} />;
  if (props.action === "squash") {
    return (
      <p>
        BB will combine this branch&apos;s committed changes into one local commit on its
        base branch. It will not fetch remote updates, push, or create a pull request.
        It bypasses pull-request review, so use it only when direct local integration
        is intended.
      </p>
    );
  }
  if (props.action === "push") return <PushDescription behind={props.behind} />;
  if (props.action === "sync") {
    return (
      <p>
        This panel will run <code>git pull --rebase</code> followed by{" "}
        <code>git push</code> in this card&apos;s worker checkout — one click, linear
        history, no merge commits. If the pull conflicts, the rebase aborts itself and
        nothing changes; resolve the conflict where you edit code and push again. The
        output streams into Push shells below.
      </p>
    );
  }
  if (props.action === "ready") {
    return <p>This makes the existing pull request ready for review. It does not merge or deploy anything.</p>;
  }
  if (props.action === "draft") {
    return <p>This returns the existing pull request to draft. Reviews and checks remain visible.</p>;
  }
  return (
    <p>
      BB will re-check the PR and request a {props.mergeMethod} merge. Repository rules,
      approvals, checks, and merge queues remain authoritative.
    </p>
  );
}

function actionLabel(props: Pick<
  PublicationActionsProps,
  "action" | "publishesToDefaultBranch" | "publicationDefaultBranch"
>) {
  if (props.action === "commit") {
    return props.publishesToDefaultBranch
      ? `Save local commit to ${props.publicationDefaultBranch}`
      : "Commit workspace";
  }
  if (props.action === "squash") return "Squash branch locally";
  if (props.action === "push") return "Push branch";
  if (props.action === "sync") return "Sync & push";
  if (props.action === "ready") return "Mark ready";
  if (props.action === "draft") return "Mark draft";
  return "Merge PR";
}

export function PublicationActions(props: PublicationActionsProps) {
  const { action, setAction, loadPublication, onChanged } = props;
  const rpc = useRpc<typeof rpcContract>();
  const [submitting, setSubmitting] = useState(false);

  async function doAction() {
    if (!action || submitting) return;
    setSubmitting(true);
    await runPublicationMutation({
      execute: () => executeAction(action, { ...props, rpc }),
      close: () => {
        setSubmitting(false);
        setAction(null);
      },
      refreshPublication: loadPublication,
      refreshCard: onChanged,
    });
  }

  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => { if (!open && !submitting) setAction(null); }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{actionTitle(props)}</DialogTitle>
          <DialogDescription className="space-y-2">
            <ActionDescription {...props} />
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>Cancel</Button>
          </DialogClose>
          <Button disabled={submitting} onClick={() => void doAction()}>
            {submitting ? "Submitting…" : actionLabel(props)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
