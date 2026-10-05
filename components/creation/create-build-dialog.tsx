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
import { AgentConfigBox, CreateCardAlert, WorkflowSettings, type KnobPrefs, type ReviewGates } from "./creation-settings";
import { useProjectSeed } from "./use-project-seed";
import { composerExecutionOf } from "./composer-execution";
import { useSeededComposerEnvironment, type ComposerEnvironmentSeed } from "./composer-environment-seed";
import { StartImmediatelyCheck } from "../start-immediately-check";
import { GithubCreateRow } from "../github/github-create-row";

// Build creation dialog: composer plus run knobs, review gates,
// agent config, and deferred start. Owns its draft, intent, error, and
// start choice; run knobs and review gates stay board defaults
// owned by the panel. Every open resets to started with a clean error.

// Build submit: parse the composer request, create the card through the
// createCard RPC, then open its detail. Owns the draft, intent, error,
// and start choice; run knobs and review gates arrive as board
// defaults. Throws after recording the error so the composer draft
// survives for an in-place retry.
// createCard payload: run knobs travel as typed fields (count as a
// number — the dialog holds it as a radio string), review checkpoints as
// the reviewMode ladder-or-set input.
type CardAttachment = { type: "localFile" | "localImage"; path: string };

function createCardPayload(
  targetProjectId: string,
  request: NewThreadRequest,
  submission: string,
  attachments: CardAttachment[],
  prefs: KnobPrefs,
  reviewGates: ReviewGates,
  startImmediately: boolean,
) {
  return {
    projectId: targetProjectId,
    environment: request.environment,
    prompt: submission,
    attachments,
    intent: "unknown" as const,
    quality: prefs.quality,
    supervisor: prefs.supervisor,
    explorationCount: Number(prefs.explorationCount),
    redFirst: prefs.redFirst,
    reviewMode: reviewGates,
    start: startImmediately,
    execution: composerExecutionOf(request),
  };
}

// Composer request split: the text is the submission, local files and
// images are attachments. A path printed in a prompt is not an attachment,
// so BB cannot render or open it in the worker thread.
function submissionOf(request: NewThreadRequest) {
  const textPart = request.input.find((part) => part.type === "text");
  const submission = textPart && "text" in textPart ? (textPart as { text: string }).text.trim() : "";
  type AttachmentPart = { type: "localFile" | "localImage"; path: string };
  const isAttachment = (part: unknown): part is AttachmentPart =>
    (part as AttachmentPart).type === "localFile" || (part as AttachmentPart).type === "localImage";
  const hasPath = (part: AttachmentPart): boolean =>
    "path" in part && typeof part.path === "string" && part.path.length > 0;
  const attachments = request.input
    .filter((part): part is AttachmentPart => isAttachment(part) && hasPath(part))
    .map((part) => ({ type: part.type, path: part.path }));
  return { submission, attachments };
}

function useCreateBuildSubmit({ activeProjectId, prefs, reviewGates, githubRepos, onClose }: {
  activeProjectId: string | null;
  prefs: KnobPrefs;
  reviewGates: ReviewGates;
  githubRepos: string[];
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [prompt, setPrompt] = useState("");
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
    const { submission, attachments } = submissionOf(request);
    if (!submission.trim() || submitBusyRef.current) return;
    submitBusyRef.current = true;
    setError(null);
    try {
      const result = await rpc.call("createCard", createCardPayload(targetProjectId, request, submission, attachments, prefs, reviewGates, startImmediately));
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
// Bucket gallery link, and run knobs plus review gates.
function CreateBuildSettings({
  analysisName, startImmediately, onStartImmediately, bucketGallery, onOpenPresets, prefs, reviewGates, githubRepos,
  createGithubIssue, setCreateGithubIssue, createGithubRepo, setCreateGithubRepo, onPrefsChange, onReviewGatesChange,
}: {
  analysisName: string;
  startImmediately: boolean;
  onStartImmediately: (value: boolean) => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
  prefs: KnobPrefs;
  reviewGates: ReviewGates;
  githubRepos: string[];
  createGithubIssue: boolean;
  setCreateGithubIssue: (value: boolean) => void;
  createGithubRepo: string | null;
  setCreateGithubRepo: (value: string | null) => void;
  onPrefsChange: (patch: Partial<KnobPrefs>) => void;
  onReviewGatesChange: (value: ReviewGates) => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 border-t pt-4">
      <AgentConfigBox
        lines={[`Analysis phase runs on ${analysisName}`]}
        onConfigure={onOpenPresets}
      />
      <StartImmediatelyCheck checked={startImmediately} onChange={onStartImmediately} onViewBucket={bucketGallery.openBucketGallery} />
      <GithubCreateRow repos={githubRepos} checked={createGithubIssue} onCheckedChange={setCreateGithubIssue} repo={createGithubRepo} onRepoChange={setCreateGithubRepo} />
      {bucketGallery.bucketGallery}
      <WorkflowSettings
        prefs={prefs}
        reviewGates={reviewGates}
        onPrefsChange={onPrefsChange}
        onReviewGatesChange={onReviewGatesChange}
        groupNamePrefix="create"
      />
    </div>
  );
}

export type CreateBuildDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
validProjectIds?: string[];
  analysisPreset: { providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; environmentKind: string; name: string } | null;
  prefs: KnobPrefs;
  reviewGates: ReviewGates;
  githubRepos: string[];
  onPrefsChange: (patch: Partial<KnobPrefs>) => void;
  onReviewGatesChange: (value: ReviewGates) => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
};

// Composer with the per-open project seed and the preset's environment seed.
// Extracted so the dialog shell stays under the function budget — one composer
// per creation dialog.
function CreateBuildComposer({ seedProjectId, analysisPreset, seededEnvironment, prompt, onSubmit }: {
  seedProjectId: string | null;
  analysisPreset: CreateBuildDialogProps["analysisPreset"];
  seededEnvironment: ComposerEnvironmentSeed;
  prompt: string;
  onSubmit: (request: NewThreadRequest) => Promise<void>;
}) {
  return (
    <NewThreadComposer
      defaultProjectId={seedProjectId ?? undefined}
      defaultProviderId={analysisPreset?.providerId}
      defaultModel={analysisPreset?.modelId}
      defaultReasoningLevel={analysisPreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
      defaultPermissionMode={analysisPreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
      defaultEnvironment={seededEnvironment}
      initialPrompt={prompt}
      placeholder="What should Stelow build?"
      layout="contained"
      draftKey="stelow-board-create"
      onSubmit={onSubmit}
    />
  );
}

export function CreateBuildDialog({
  open, onOpenChange, activeProjectId, validProjectIds,
  analysisPreset, prefs, reviewGates, githubRepos,
  onPrefsChange, onReviewGatesChange, bucketGallery, onOpenPresets,
}: CreateBuildDialogProps) {
  const { seedProjectId, openChange, submitWithMemory } = useProjectSeed({ activeProjectId, validProjectIds });
  const submit = useCreateBuildSubmit({ activeProjectId: seedProjectId, prefs, reviewGates, githubRepos, onClose: () => onOpenChange(false) });
  const seededEnvironment = useSeededComposerEnvironment(analysisPreset?.environmentKind, open);

  return (
    <Dialog open={open} onOpenChange={(next) => openChange(next, onOpenChange, submit.resetOnOpen)}>
      <DialogContent fullscreenOnMobile className="overflow-y-auto overflow-x-hidden sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Start new issue</DialogTitle>
          <DialogDescription>Describe the outcome, problem, or change. Run knobs and review checkpoints below start from the board defaults.</DialogDescription>
        </DialogHeader>
        {submit.error ? <CreateCardAlert message={submit.error} /> : null}
        <CreateBuildComposer
          seedProjectId={seedProjectId}
          analysisPreset={analysisPreset}
          seededEnvironment={seededEnvironment}
          prompt={submit.prompt}
          onSubmit={(request) => submitWithMemory(request, submit.start)}
        />
        <CreateBuildSettings
          analysisName={analysisPreset?.name ?? "Default"}
          startImmediately={submit.startImmediately}
          onStartImmediately={submit.setStartImmediately}
          bucketGallery={bucketGallery}
          onOpenPresets={onOpenPresets}
          prefs={prefs}
          reviewGates={reviewGates}
          githubRepos={submit.githubRepos}
          createGithubIssue={submit.createGithubIssue}
          setCreateGithubIssue={submit.setCreateGithubIssue}
          createGithubRepo={submit.createGithubRepo}
          setCreateGithubRepo={submit.setCreateGithubRepo}
          onPrefsChange={onPrefsChange}
          onReviewGatesChange={onReviewGatesChange}
        />
      </DialogContent>
    </Dialog>
  );
}
