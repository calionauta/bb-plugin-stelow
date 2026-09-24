import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ArtifactOption = { path: string; display: string; role: string };

export function GithubDoneDraftDialog({ open, onOpenChange, cardId, artifacts, issueRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  artifacts: ArtifactOption[];
  issueRef: { repo: string; number: number } | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setError(null);
    setChecked(artifacts.filter((artifact) => artifact.role === "deliverable").map((artifact) => artifact.path));
    setLoading(true);
    rpc.call("draftDoneComment", { cardId }).then(
      (result) => {
        if (result.ok && result.draft) setText(result.draft);
        else setError(result.error ?? "Could not draft the comment — write it yourself below.");
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Could not draft the comment — write it yourself below."),
    ).finally(() => setLoading(false));
  }, [open, cardId, rpc]);

  const post = async () => {
    const list = artifacts.filter((artifact) => checked.includes(artifact.path));
    const body = text.trim() + (list.length > 0 ? `\n\nArtifacts:\n${list.map((artifact) => `- ${artifact.display} (${artifact.path})`).join("\n")}` : "");
    if (!body.trim()) {
      setError("Comment must not be empty.");
      return;
    }
    setPosting(true);
    try {
      const result = await rpc.call("postIssueComment", { cardId, body });
      if (!result.ok) {
        setError(result.error ?? "GitHub refused the comment.");
        return;
      }
      onOpenChange(false);
      toast.success("Comment posted on GitHub.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "GitHub refused the comment.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Draft GitHub comment?</DialogTitle>
          <DialogDescription>
            Drafted with the cheap generation preset for {issueRef ? `${issueRef.repo}#${issueRef.number}` : "the linked issue"} — judge every word before posting. Checked artifacts append as a list; uncheck to detach.
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-muted-foreground">Drafting…</p> : (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Comment (editable)</span>
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} className="min-h-32 w-full rounded-md border bg-background p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" placeholder="Write the completion note…" />
            </label>
            {artifacts.length > 0 ? (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Artifacts ({checked.length} attached)</span>
                {artifacts.map((artifact) => (
                  <label key={artifact.path} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/60">
                    <input type="checkbox" checked={checked.includes(artifact.path)} onChange={(event) => setChecked((prev) => event.target.checked ? [...prev, artifact.path] : prev.filter((path) => path !== artifact.path))} className="size-4 accent-primary" />
                    <span className="min-w-0 flex-1 truncate">{artifact.display}</span>
                  </label>
                ))}
              </div>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={posting} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" disabled={posting || loading || !text.trim()} onClick={() => void post()}>{posting ? "Posting…" : "Post to GitHub"}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
