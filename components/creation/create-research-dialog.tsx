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

// Research creation dialog: strategy picker plus deferred start. Owns its
// draft, strategy, attention signal, error, and start choice; the strategy
// catalog arrives as a prop. A submit without a strategy flashes the
// picker and throws so the composer keeps the draft. Every open resets
// to no strategy, started, with a clean error.

function useCreateResearchSubmit({ activeProjectId, onClose }: {
  activeProjectId: string | null;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] = useState<string | null>(null);
  const [strategyAttention, setStrategyAttention] = useState(0);
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
    if (!strategy) {
      toast.error("Pick a strategy first.");
      setStrategyAttention((count) => count + 1);
      // Throw so the composer keeps the draft: a blocked submit must never
      // lose what the user typed (SDK clears the draft only on resolve).
      throw new Error("Pick a strategy first.");
    }
    setError(null);
    try {
      const result = await rpc.call("createResearchCard", { projectId: targetProjectId, environment: request.environment, prompt: text, attachments, strategy, start: startImmediately, execution: composerExecutionOf(request) });
      setPrompt("");
      onClose();
      navigate.openThreadPanel({ actionId: "stelow-card-detail", title: result.cardId, params: { cardId: result.cardId } });
      toast.success(startImmediately ? "Research started. Results will appear on this card when ready." : "Research parked in Bucket. Start it from the card when ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start research.";
      setError(message);
      toast.error(message);
      throw error;
    }
  }
  function resetOnOpen() {
    setStrategy(null);
    setStartImmediately(true);
    setError(null);
  }
  return { prompt, strategy, setStrategy, strategyAttention, error, startImmediately, setStartImmediately, start, resetOnOpen };
}

function CreateResearchSettings({ strategies, strategy, onStrategy, strategyAttention, researchName, hasBandPreset, startImmediately, onStartImmediately, bucketGallery, onOpenPresets }: {
  strategies: ResearchStrategyOption[];
  strategy: string | null;
  onStrategy: (id: string) => void;
  strategyAttention: number;
  researchName: string;
  hasBandPreset: boolean;
  startImmediately: boolean;
  onStartImmediately: (value: boolean) => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Choose a strategy</span>
        <StrategyPicker strategies={strategies} value={strategy} onChange={onStrategy} groupName="strategy-pick" attentionSignal={strategyAttention} />
      </div>
      <AgentConfigBox
        lines={[`Research runs on ${researchName}${hasBandPreset ? "" : " (board default)"}`]}
        onConfigure={onOpenPresets}
      />
      <StartImmediatelyCheck checked={startImmediately} onChange={onStartImmediately} onViewBucket={bucketGallery.openBucketGallery} />
      {bucketGallery.bucketGallery}
    </div>
  );
}

export type CreateResearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
  strategies: ResearchStrategyOption[];
  researchPreset: { providerId: string; modelId: string; reasoningLevel: string; permissionMode: string; name: string } | null;
  hasBandPreset: boolean;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
};

export function CreateResearchDialog({ open, onOpenChange, activeProjectId, strategies, researchPreset, hasBandPreset, bucketGallery, onOpenPresets }: CreateResearchDialogProps) {
  const submit = useCreateResearchSubmit({ activeProjectId, onClose: () => onOpenChange(false) });

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) submit.resetOnOpen();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent fullscreenOnMobile className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Start new research</DialogTitle>
          <DialogDescription>Pick a strategy below, then describe what to investigate. One strategy per round — run more rounds from the card to compound perspectives.</DialogDescription>
        </DialogHeader>
        {submit.error ? <CreateCardAlert message={submit.error} /> : null}
        <CreateResearchSettings
          strategies={strategies}
          strategy={submit.strategy}
          onStrategy={submit.setStrategy}
          strategyAttention={submit.strategyAttention}
          researchName={researchPreset?.name ?? "Default"}
          hasBandPreset={hasBandPreset}
          startImmediately={submit.startImmediately}
          onStartImmediately={submit.setStartImmediately}
          bucketGallery={bucketGallery}
          onOpenPresets={onOpenPresets}
        />
        <NewThreadComposer
          defaultProjectId={activeProjectId ?? undefined}
          defaultProviderId={researchPreset?.providerId}
          defaultModel={researchPreset?.modelId}
          defaultReasoningLevel={researchPreset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
          defaultPermissionMode={researchPreset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
          initialPrompt={submit.prompt}
          placeholder="What should Stelow investigate?"
          layout="contained"
          draftKey="stelow-research-create"
          onSubmit={(request) => submit.start(request)}
        />
      </DialogContent>
    </Dialog>
  );
}
