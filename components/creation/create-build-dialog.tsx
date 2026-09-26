import { useRef, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  useRpc,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentConfigBox, CreateCardAlert, WorkflowSettings, type Appetite, type ReviewGates } from "./creation-settings";
import { composerExecutionOf } from "./composer-execution";
import { StartImmediatelyCheck } from "../start-immediately-check";
import { GithubCreateRow } from "../github/github-create-row";

// Build creation dialog: composer plus planning depth, review gates,
// agent config, and deferred start. Owns its draft, intent, error, and
// start choice; planning depth and review gates stay board defaults
// owned by the panel. Every open resets to started with a clean error.

// Build submit: parse the composer request, create the card through the
// createCard RPC, then open its detail. Owns the draft, intent, error,
// and start choice; planning depth and review gates arrive as board
// defaults. Throws after recording the error so the composer draft
// survives for an in-place retry.
function useCreateBuildSubmit({ activeProjectId, appetite, reviewGates, githubRepos, onClose }: {
  activeProjectId: string | null;
  appetite: Appetite;
  reviewGates: ReviewGates;
  githubRepos: string[];
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [prompt, setPrompt] = useState("");
  const intent = "unknown" as const;
  const [error, setError] = useState<string | null>(null);
  // Deferred start: unchecked parks the card in Bucket with no worker.
  // Checked (default) preserves today's behavior — spawn on submit.
  const [startImmediately, setStartImmediately] = useState(true);
  const [createGithubIssue, setCreateGithubIssue] = useState(false);
  const [createGithubRepo, setCreateGithubRepo] = useState<string | null>(null);
  const submitBusyRef = useRef(false);
  async function start(request: NewThreadRequest) {
    const targetProjectId = request.projectId || activeProjectId;
    if (!targetProjectId) return;
    // Keep files structured: a path printed in a prompt is not an attachment,
    // so BB cannot render or open it in the worker thread.
    const textPart = request.input.find((part) => part.type === "text");
    const text = textPart && "text" in textPart ? (textPart as { text: string }).text.trim() : "";
    const attachments = request.input
      .filter((part): part is { type: "localFile" | "localImage"; path: string } => (part.type === "localFile" || part.type === "localImage") && "path" in part && typeof part.path === "string" && part.path.length > 0)
      .map((part) => ({ type: part.type, path: part.path }));
    const submission = text;
    if (!submission.trim() || submitBusyRef.current) return;
    submitBusyRef.current = true;
    setError(null);
    try {
      const result = await rpc.call("createCard", { projectId: targetProjectId, environment: request.environment, prompt: submission, attachments, intent, appetite, reviewMode: reviewGates, start: startImmediately, execution: composerExecutionOf(request) });
      setPrompt("");
      if (createGithubIssue) {
        try {
          const link = await rpc.call("createLinkedGithubIssue", { cardId: result.cardId, repo: createGithubRepo });
          if (link.ok && link.url) toast.success(`GitHub issue #${link.number} created and linked.`);
          else toast.error(link.error ?? "GitHub issue creation failed — the card stands without a link.");
        } catch (githubError) {
          toast.error(githubError instanceof Error ? githubError.message : "GitHub issue creation failed — the card stands without a link.");
        }
      }
      onClose();
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success(startImmediately ? "Card started in Triage. Stelow will triage it." : "Card parked in Bucket. Start it from the card when ready.");
      submitBusyRef.current = false;
    } catch (error) {
      submitBusyRef.current = false;
      const message = error instanceof Error ? error.message : "Unable to start the card.";
      setError(message);
      toast.error(message);
      throw error;
    }
  }
  function resetOnOpen() {
    setStartImmediately(true);
    setCreateGithubIssue(false);
    setCreateGithubRepo(null);
    submitBusyRef.current = false;
    setError(null);
  }
  return { prompt, error, startImmediately, setStartImmediately, createGithubIssue, setCreateGithubIssue, createGithubRepo, setCreateGithubRepo, start, resetOnOpen, githubRepos };
}

// Settings under the composer: agent config, deferred start with the
// Bucket gallery link, and planning depth plus review gates.
function CreateBuildSettings({ analysisName, startImmediately, onStartImmediately, bucketGallery, onOpenPresets, appetite, reviewGates, githubRepos, createGithubIssue, setCreateGithubIssue, createGithubRepo, setCreateGithubRepo, onAppetiteChange, onReviewGatesChange }: {
  analysisName: string;
  startImmediately: boolean;
  onStartImmediately: (value: boolean) => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
  appetite: Appetite;
  reviewGates: ReviewGates;
  githubRepos: string[];
  createGithubIssue: boolean;
  setCreateGithubIssue: (value: boolean) => void;
  createGithubRepo: string | null;
  setCreateGithubRepo: (value: string | null) => void;
  onAppetiteChange: (value: Appetite) => void;
  onReviewGatesChange: (value: ReviewGates) => void;
}) {
  return (
    <div className="grid gap-4 border-t pt-4">
      <AgentConfigBox
        lines={[`Analysis phase runs on ${analysisName}`]}
        onConfigure={onOpenPresets}
      />
      <StartImmediatelyCheck checked={startImmediately} onChange={onStartImmediately} onViewBucket={bucketGallery.openBucketGallery} />
      <GithubCreateRow repos={githubRepos} checked={createGithubIssue} onCheckedChange={setCreateGithubIssue} repo={createGithubRepo} onRepoChange={setCreateGithubRepo} />
      {bucketGallery.bucketGallery}
      <WorkflowSettings appetite={appetite} reviewGates={reviewGates} onAppetiteChange={onAppetiteChange} onReviewGatesChange={onReviewGatesChange} groupNamePrefix="create" />
    </div>
  );
}

export type CreateBuildDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
  analysisPreset: { providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; name: string } | null;
  appetite: Appetite;
  reviewGates: ReviewGates;
  githubRepos: string[];
  onAppetiteChange: (value: Appetite) => void;
  onReviewGatesChange: (value: ReviewGates) => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
};

export function CreateBuildDialog({ open, onOpenChange, activeProjectId, analysisPreset, appetite, reviewGates, githubRepos, onAppetiteChange, onReviewGatesChange, bucketGallery, onOpenPresets }: CreateBuildDialogProps) {
  const submit = useCreateBuildSubmit({ activeProjectId, appetite, reviewGates, githubRepos, onClose: () => onOpenChange(false) });

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) submit.resetOnOpen();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Start new issue</DialogTitle>
          <DialogDescription>Describe the outcome, problem, or change. Planning depth and review checkpoints below start from the board defaults — keep them or adjust, then submit.</DialogDescription>
        </DialogHeader>
        {submit.error ? <CreateCardAlert message={submit.error} /> : null}
        <NewThreadComposer
          defaultProjectId={activeProjectId ?? undefined}
          defaultProviderId={analysisPreset?.providerId}
          defaultModel={analysisPreset?.modelId}
          defaultReasoningLevel={analysisPreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
          defaultPermissionMode={analysisPreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
          initialPrompt={submit.prompt}
          placeholder="What should Stelow build?"
          layout="contained"
          draftKey="stelow-board-create"
          onSubmit={(request) => submit.start(request)}
        />
        <CreateBuildSettings
          analysisName={analysisPreset?.name ?? "Default"}
          startImmediately={submit.startImmediately}
          onStartImmediately={submit.setStartImmediately}
          bucketGallery={bucketGallery}
          onOpenPresets={onOpenPresets}
          appetite={appetite}
          reviewGates={reviewGates}
          githubRepos={submit.githubRepos}
          createGithubIssue={submit.createGithubIssue}
          setCreateGithubIssue={submit.setCreateGithubIssue}
          createGithubRepo={submit.createGithubRepo}
          setCreateGithubRepo={submit.setCreateGithubRepo}
          onAppetiteChange={onAppetiteChange}
          onReviewGatesChange={onReviewGatesChange}
        />
      </DialogContent>
    </Dialog>
  );
}
