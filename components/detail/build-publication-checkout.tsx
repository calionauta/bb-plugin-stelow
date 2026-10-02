import { Button } from "@/components/ui/button";
import { SUMMARY_BASE } from "../disclosure";
import { z } from "zod";
import type { PublicationAction } from "./build-publication-actions";
import type { rpcContract } from "../../server";

/**
 * What the checkout this card runs in permits, and the one action that is
 * only safe when nobody else is using the clone.
 *
 * Both are things a reader needs *before* clicking, not after: the panel
 * offers a working Commit button on a shared default branch and would
 * otherwise let a reader conclude that committing publishes.
 */

type PublicationStatus = z.infer<typeof rpcContract.publicationStatus.output>;

/**
 * What the panel can and cannot do from where this card is checked out.
 *
 * The default-branch case gets the long answer because it is the one that
 * misleads: a reader on master sees a working Commit button and reasonably
 * concludes the panel publishes, and it does not — it writes a local commit
 * and stops. Saying that here is cheaper than a user discovering it after.
 */
export function CheckoutOwnershipNote({
  publishesToDefaultBranch,
  defaultBranch,
}: {
  publishesToDefaultBranch: boolean;
  defaultBranch: string | null;
}) {
  if (!publishesToDefaultBranch) {
    return (
      <p className="text-muted-foreground">
        BB owns commit execution on the workspace host. Stelow never stages or runs Git commands locally.
      </p>
    );
  }
  return (
    <p className="text-muted-foreground">
      This is the default checkout selected in BB. BB creates a local commit on{" "}
      <code>{defaultBranch}</code> only: it cannot fetch remote updates, merge incoming
      changes, push, or create a pull request from this panel. Before saving, confirm that
      this checkout is current and exclusively yours. Choose a feature branch or managed
      worktree in BB’s composer for a pull-request workflow.
    </p>
  );
}

/**
 * The local squash, behind a disclosure because it is a destructive-shaped
 * action on a shared checkout: it rewrites the local base branch and never
 * reaches a remote, so it is only safe when nobody else is using the clone.
 */
export function LocalSquashDisclosure({
  publication,
  open,
  setOpen,
  setAction,
}: {
  publication: NonNullable<PublicationStatus>;
  open: boolean;
  setOpen: (open: boolean) => void;
  setAction: (action: PublicationAction | null) => void;
}) {
  return (
    <details
      className="group border-t pt-3"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      {/* SUMMARY_BASE carries list-none, focus-visible:outline and marker:hidden;
          composing it here keeps keyboard focus visible (WCAG 2.4.7) and the marker
          hidden, instead of restating a subset of what the token already guarantees. */}
      <summary className={`flex items-center gap-1.5 font-medium text-foreground ${SUMMARY_BASE}`}>
        Advanced Git operations
      </summary>
      <div className="mt-2 space-y-2 text-muted-foreground">
        <p>
          Squash branch locally combines this branch’s already committed changes into one
          commit on its local base branch. It does not fetch remote updates, push, or create
          a pull request. Use it only when you own local integration.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={!publication.capabilities.squashMerge.available}
          title={publication.capabilities.squashMerge.reason ?? "Squash committed branch changes into the local base branch"}
          onClick={() => setAction("squash")}
        >
          Squash branch locally…
        </Button>
      </div>
    </details>
  );
}
