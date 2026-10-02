import { UrlLink } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { copyText } from "./copy-text";
import type { rpcContract } from "../../server";

/**
 * The record of what the user actually did, and the note that says what the
 * card still owes its repository.
 *
 * Both are read-only statements about recorded facts, which is why they sit
 * together: the history is the evidence, and the notice is the reading of it.
 * A reader deciding whether to trust the notice can check it against the list
 * directly underneath.
 */

type PublicationStatus = z.infer<typeof rpcContract.publicationStatus.output>;
export function PublicationHistory({ events, openCommit }: {
  events: NonNullable<PublicationStatus>["events"];
  openCommit: (sha: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="border-t pt-3">
      <p className="mb-1 font-medium text-foreground">Publication history</p>
      <ul className="space-y-1 text-muted-foreground">
        {events.map((event) => (
          <li key={event.id}>
            {event.action.replaceAll("_", " ")} ·{" "}
            {event.commitSha
              ? event.message.replace(event.commitSha, event.commitSha.slice(0, 7))
              : event.message}
            {event.commitSha ? (
              <>
                {" · "}
                <button
                  type="button"
                  className="cursor-pointer text-primary underline-offset-2 hover:underline"
                  onClick={() => void openCommit(event.commitSha!)}
                  title={`View ${event.commitSha.slice(0, 7)} in BB`}
                >
                  View commit
                </button>
              </>
            ) : null}
            {event.pullRequestUrl ? (
              <>
                {" · "}
                <UrlLink href={event.pullRequestUrl} className="text-primary underline-offset-2 hover:underline">
                  Open PR
                </UrlLink>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What this finished card still owes its repository, stated once above the
 * buttons that would fix it.
 *
 * Placed before the actions rather than after the history on purpose: a reader
 * arriving from the board chip needs to know which button to reach for, and
 * the history below is where they check whether to believe it.
 */
export function IntegrationPendingNotice({ pending }: { pending: { label: string; detail: string } }) {
  return (
    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-200">
      <span className="font-medium">Still to integrate.</span> {pending.detail}
    </p>
  );
}
