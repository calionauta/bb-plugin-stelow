import { Markdown } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { DisclosureSection } from "../disclosure";
import { OpenThreadButton } from "../worker-history/worker-history";

// Card ↔ agent thread: comment history (you vs agent) plus the compose
// box (Cmd/Ctrl+Enter sends, empty draft disables Send). Every detail
// body renders the same conversation — one definition, not three copies.

// Structural view of one comment: the thread only reads identity,
// authorship, timestamp, and body.
export type CardCommentItem = { id: string; author: string; createdAt: number; body: string };

export function CardConversation({ comments, draft, onDraftChange, onSend, defaultOpen = false, threadId }: {
  comments: CardCommentItem[]; draft: string; onDraftChange: (value: string) => void; onSend: () => void; defaultOpen?: boolean; threadId?: string | null;
}) {
  return (
    <DisclosureSection
      title="Conversation"
      hint={comments.length ? `${comments.length}` : "talk to the agent"}
      defaultOpen={defaultOpen}
    >
      <div className="space-y-2">
        {comments.length ? comments.map((entry) => {
          const mine = entry.author !== "agent";
          return (
            <div key={entry.id} className={`rounded-lg border p-2.5 ${mine ? "border-primary/25 bg-primary/5" : "border-border bg-muted/30"}`}>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${mine ? "bg-primary" : "bg-muted-foreground"}`} />
                <span className="font-medium text-foreground">{mine ? "You" : "Agent"}</span>
                <span title={new Date(entry.createdAt).toLocaleString()}>{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-sm leading-relaxed"><Markdown content={entry.body} /></div>
            </div>
          );
        }) : <p className="text-xs text-muted-foreground">No comments yet — send the first note to the agent below.</p>}
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Write to the agent</span>
        <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} rows={3} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder="Ask, correct, or add context... (Cmd/Ctrl+Enter to send)" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && draft.trim()) onSend(); }} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter sends · attachments and @mentions live in the worker thread</span>
        <span className="ml-auto inline-flex items-center gap-2">
          {threadId ? <OpenThreadButton threadId={threadId} /> : null}
          <Button disabled={!draft.trim()} onClick={() => onSend()}>Send to agent</Button>
        </span>
      </div>
    </DisclosureSection>
  );
}
