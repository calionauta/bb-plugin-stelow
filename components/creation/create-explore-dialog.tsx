import { useState } from "react";
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
import { AgentConfigBox, CreateCardAlert, type ResearchStrategyOption } from "./creation-settings";
import { StrategyPicker } from "./strategy-picker";
import { composerExecutionOf } from "./composer-execution";
import { StartImmediatelyCheck } from "../start-immediately-check";

// Explore creation dialog: technique picker plus deferred start. Owns its
// draft, stage, attention signal, error, and start choice; the technique
// catalog arrives as a prop. A submit without a stage flashes the picker
// and throws so the composer keeps the draft. Every open resets to no
// stage, started, with a clean error.

function useCreateExploreSubmit({ activeProjectId, onClose }: {
  activeProjectId: string | null;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [stageAttention, setStageAttention] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [startImmediately, setStartImmediately] = useState(true);
  async function start(request: NewThreadRequest) {
    const targetProjectId = request.projectId || activeProjectId;
    if (!targetProjectId) return;
    const textPart = request.input.find((part) => part.type === "text");
    const text = textPart && "text" in textPart ? (textPart as { text: string }).text.trim() : "";
    const attachments = request.input
      .filter((part): part is { type: "localFile" | "localImage"; path: string } => (part.type === "localFile" || part.type === "localImage") && "path" in part && typeof part.path === "string" && part.path.length > 0)
      .map((part) => ({ type: part.type, path: part.path }));
    if (!text.trim()) return;
    if (!stage) {
      toast.error("Pick a stage first.");
      setStageAttention((count) => count + 1);
      // Throw so the composer keeps the draft: a blocked submit must never
      // lose what the user typed (SDK clears the draft only on resolve).
      throw new Error("Pick a stage first.");
    }
    setError(null);
    try {
      const result = await rpc.call("createExploreCard", { projectId: targetProjectId, environment: request.environment, prompt: text, attachments, stageId: stage, start: startImmediately, execution: composerExecutionOf(request) });
      setPrompt("");
      onClose();
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success(startImmediately ? "Exploration started. The result will appear on this card when ready." : "Exploration parked in Bucket. Start it from the card when ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start exploration.";
      setError(message);
      toast.error(message);
      throw error;
    }
  }
  function resetOnOpen() {
    setStage(null);
    setStartImmediately(true);
    setError(null);
  }
  return { prompt, stage, setStage, stageAttention, error, startImmediately, setStartImmediately, start, resetOnOpen };
}

function CreateExploreSettings({ stages, stage, onStage, stageAttention, exploreName, hasBandPreset, startImmediately, onStartImmediately, bucketGallery, onOpenPresets }: {
  stages: ResearchStrategyOption[];
  stage: string | null;
  onStage: (id: string) => void;
  stageAttention: number;
  exploreName: string;
  hasBandPreset: boolean;
  startImmediately: boolean;
  onStartImmediately: (value: boolean) => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Choose a technique</span>
        <StrategyPicker strategies={stages} value={stage} onChange={onStage} groupName="stage-pick" attentionSignal={stageAttention} noun="techniques" legend="Technique" />
      </div>
      <AgentConfigBox
        lines={[`Explore runs on ${exploreName}${hasBandPreset ? "" : " (board default)"}`]}
        onConfigure={onOpenPresets}
      />
      <StartImmediatelyCheck checked={startImmediately} onChange={onStartImmediately} onViewBucket={bucketGallery.openBucketGallery} />
      {bucketGallery.bucketGallery}
    </div>
  );
}

export type CreateExploreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
  stages: ResearchStrategyOption[];
  explorePreset: { providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; name: string } | null;
  hasBandPreset: boolean;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
};

export function CreateExploreDialog({ open, onOpenChange, activeProjectId, stages, explorePreset, hasBandPreset, bucketGallery, onOpenPresets }: CreateExploreDialogProps) {
  const submit = useCreateExploreSubmit({ activeProjectId, onClose: () => onOpenChange(false) });

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) submit.resetOnOpen();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Start new exploration</DialogTitle>
            <DialogDescription>Pick one technique below, then describe the input — an idea, an existing proposal, a codebase, or a URL. The agent runs that approach and returns a focused result.</DialogDescription>
        </DialogHeader>
        {submit.error ? <CreateCardAlert message={submit.error} /> : null}
        <CreateExploreSettings
          stages={stages}
          stage={submit.stage}
          onStage={submit.setStage}
          stageAttention={submit.stageAttention}
          exploreName={explorePreset?.name ?? "Default"}
          hasBandPreset={hasBandPreset}
          startImmediately={submit.startImmediately}
          onStartImmediately={submit.setStartImmediately}
          bucketGallery={bucketGallery}
          onOpenPresets={onOpenPresets}
        />
        <NewThreadComposer
          defaultProjectId={activeProjectId ?? undefined}
          defaultProviderId={explorePreset?.providerId}
          defaultModel={explorePreset?.modelId}
          defaultReasoningLevel={explorePreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
          defaultPermissionMode={explorePreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
          initialPrompt={submit.prompt}
          placeholder="What should Stelow explore?"
          layout="contained"
          draftKey="stelow-explore-create"
          onSubmit={(request) => submit.start(request)}
        />
      </DialogContent>
    </Dialog>
  );
}
