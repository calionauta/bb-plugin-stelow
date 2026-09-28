import { DisclosureSection } from "../disclosure";
import { cn } from "../../lib/utils";
import { OpenThreadButton } from "../worker-history/worker-history";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";

// Card ↔ agent, honestly named.
//
// This used to be called "Conversation", hinted "talk to the agent", labelled
// its textarea "Write to the agent" and its button "Send to agent" — four
// different names for a feature that is not a conversation. `addCardComment`
// writes with `target: "card"`: it appends a note to the card's log, which the
// worker reads on its next poll. There is no live channel, and a section that
// promises one teaches people to wait for a reply that is not coming.
//
// The real conversation is the worker thread, and it is one click away — so the
// thread is what this section leads with, in the HEADER, where it is reachable
// with the section still closed. The note composer stays, because it is a
// different job: five words of course-correction that do not justify losing
// your place on the card to go and find a thread. It is a note, so it is named
// one.
export type CardCommentItem = { id: string; author: string; createdAt: number; body: string };

// A note is yours or the agent's, and that is the only thing that changes
// about it. Named rather than written inline so the two never drift a colour
// apart, which is what a card log looks like when "your" side stops being
// distinguishable.
const NOTE_SURFACE = "rounded-lg border p-2.5";
const NOTE_MINE = "border-primary/25 bg-primary/5";
const NOTE_THEIRS = "border-border bg-muted/30";

// One text input's affordances: 44px tall, comfortable reading size, and the
// focus ring every other control on the card uses.
const NOTE_INPUT = [
  "min-h-24 w-full rounded-md border bg-background p-2 text-sm leading-relaxed",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
].join(" ");

export function CardConversation({ comments, draft, onDraftChange, onSend, defaultOpen = false, threadId }: {
  comments: CardCommentItem[]; draft: string; onDraftChange: (value: string) => void; onSend: () => void; defaultOpen?: boolean; threadId?: string | null;
}) {
  return (
    <DisclosureSection
      title="Notes for the agent"
      hint={comments.length ? `${comments.length}` : threadId ? "open the thread to talk" : "none yet"}
      // The thread is the conversation, so it is the section's action — visible
      // in the header, one click, without expanding anything. The row already
      // stops propagation on its action slot, so this cannot toggle the section
      // it lives in.
      action={threadId ? <OpenThreadButton threadId={threadId} /> : null}
      defaultOpen={defaultOpen}
    >
      {comments.length ? (
        <div className="space-y-2">
          {comments.map((entry) => <Note key={entry.id} entry={entry} />)}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No notes yet. A note reaches the agent on its next turn — for a real exchange, open the thread.
        </p>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Leave a note</span>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          rows={3}
          className={NOTE_INPUT}
          placeholder="Correct, add context, or answer ahead of the next turn… (Cmd/Ctrl+Enter)"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && draft.trim()) onSend();
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Read on the agent&apos;s next turn · attachments and @mentions live in the thread</span>
        <span className="ml-auto">
          <Button disabled={!draft.trim()} onClick={() => onSend()}>Leave note</Button>
        </span>
      </div>
    </DisclosureSection>
  );
}

/** One note, as a card log entry. */
function Note({ entry }: { entry: CardCommentItem }) {
  const mine = entry.author !== "agent";
  return (
    <div className={cn(NOTE_SURFACE, mine ? NOTE_MINE : NOTE_THEIRS)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", mine ? "bg-primary" : "bg-muted-foreground")} />
        <span className="font-medium text-foreground">{mine ? "You" : "Agent"}</span>
        <span title={new Date(entry.createdAt).toLocaleString()}>{new Date(entry.createdAt).toLocaleString()}</span>
      </div>
      <div className="mt-1 text-sm leading-relaxed"><Markdown content={entry.body} /></div>
    </div>
  );
}
