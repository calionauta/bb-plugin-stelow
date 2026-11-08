import { useState } from "react";
import {
  useBbNavigate,
  useRpc,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { toast } from "sonner";
import { AgentConfigBox, type ResearchStrategyOption } from "./creation-settings";
import { useProjectSeed } from "./use-project-seed";
import { StrategyPicker } from "./strategy-picker";
import { composerExecutionOf } from "./composer-execution";
import { useSeededComposerEnvironment } from "./composer-environment-seed";
import { CreateCardComposer, CreateCardDialogShell, submissionOf } from "./create-card-shared";
import { StartImmediatelyCheck } from "../start-immediately-check";

export type TrackDialogConfig = {
  kind: "explore" | "research";
  rpcName: "createExploreCard" | "createResearchCard";
  payloadKey: "stageId" | "strategy";
  selectionNoun: "stage" | "strategy";
  pickerTitle: string;
  pickerGroup: string;
  pickerNoun?: string;
  pickerLegend?: string;
  draftKey: string;
  placeholder: string;
  dialogTitle: string;
  dialogDescription: string;
  toastStarted: string;
  toastParked: string;
  errorFallback: string;
  bandVerb: string;
};

export const EXPLORE_DIALOG_CONFIG: TrackDialogConfig = {
  kind: "explore",
  rpcName: "createExploreCard",
  payloadKey: "stageId",
  selectionNoun: "stage",
  pickerTitle: "Choose a technique",
  pickerGroup: "stage-pick",
  pickerNoun: "techniques",
  pickerLegend: "Technique",
  draftKey: "stelow-explore-create",
  placeholder: "What should Stelow explore?",
  dialogTitle: "Start new exploration",
  dialogDescription: "Pick one technique below, then describe the input — an idea, an existing proposal, "
    + "a codebase, or a URL. The agent runs that approach and returns a focused result.",
  toastStarted: "Exploration started. The result will appear on this card when ready.",
  toastParked: "Exploration parked in Bucket. Start it from the card when ready.",
  errorFallback: "Unable to start exploration.",
  bandVerb: "Explore runs on",
};

export const RESEARCH_DIALOG_CONFIG: TrackDialogConfig = {
  kind: "research",
  rpcName: "createResearchCard",
  payloadKey: "strategy",
  selectionNoun: "strategy",
  pickerTitle: "Choose a strategy",
  pickerGroup: "strategy-pick",
  draftKey: "stelow-research-create",
  placeholder: "What should Stelow investigate?",
  dialogTitle: "Start new research",
  dialogDescription: "Pick a strategy below, then describe what to investigate. One strategy per round — "
    + "run more rounds from the card to compound perspectives.",
  toastStarted: "Research started. Results will appear on this card when ready.",
  toastParked: "Research parked in Bucket. Start it from the card when ready.",
  errorFallback: "Unable to start research.",
  bandVerb: "Research runs on",
};

export type TrackPreset = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  name: string;
} | null;

async function callTrackCreate(rpc: ReturnType<typeof useRpc<typeof rpcContract>>, config: TrackDialogConfig, base: {
  projectId: string;
  environment: unknown;
  prompt: string;
  attachments: Array<{ type: "localFile" | "localImage"; path: string }>;
  start: boolean;
  execution: ReturnType<typeof composerExecutionOf>;
}, selection: string) {
  return config.rpcName === "createExploreCard"
    ? rpc.call("createExploreCard", { ...base, stageId: selection })
    : rpc.call("createResearchCard", { ...base, strategy: selection });
}

function finishTrackCreate({ setPrompt, onClose, navigate, toastStarted, toastParked, startImmediately, cardId }: {
  setPrompt: (value: string) => void;
  onClose: () => void;
  navigate: ReturnType<typeof useBbNavigate>;
  toastStarted: string;
  toastParked: string;
  startImmediately: boolean;
  cardId: string;
}) {
  setPrompt("");
  onClose();
  navigate.openThreadPanel({ actionId: "stelow-card-detail", title: cardId, params: { cardId } });
  toast.success(startImmediately ? toastStarted : toastParked);
}

export function useCreateTrackSubmit({ activeProjectId, onClose, config }: {
  activeProjectId: string | null;
  onClose: () => void;
  config: TrackDialogConfig;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [prompt, setPrompt] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [selectionAttention, setSelectionAttention] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [startImmediately, setStartImmediately] = useState(true);
  async function start(request: NewThreadRequest) {
    const targetProjectId = request.projectId || activeProjectId;
    if (!targetProjectId) return;
    const { submission: text, attachments } = submissionOf(request);
    if (!text.trim()) return;
    if (!selection) {
      toast.error(`Pick a ${config.selectionNoun} first.`);
      setSelectionAttention((count) => count + 1);
      throw new Error(`Pick a ${config.selectionNoun} first.`);
    }
    setError(null);
    try {
      const base = {
        projectId: targetProjectId,
        environment: request.environment,
        prompt: text,
        attachments,
        start: startImmediately,
        execution: composerExecutionOf(request),
      };
      const result = await callTrackCreate(rpc, config, base, selection);
      finishTrackCreate({ setPrompt, onClose, navigate, toastStarted: config.toastStarted, toastParked: config.toastParked,
        startImmediately, cardId: result.cardId });
    } catch (error) {
      const message = error instanceof Error ? error.message : config.errorFallback;
      setError(message);
      toast.error(message);
      throw error;
    }
  }
  function resetOnOpen() {
    setSelection(null);
    setStartImmediately(true);
    setError(null);
  }
  return { prompt, selection, setSelection, selectionAttention, error, startImmediately, setStartImmediately, start, resetOnOpen };
}

function CreateTrackSettings({
  catalog,
  selection,
  onSelection,
  selectionAttention,
  presetName,
  hasBandPreset,
  startImmediately,
  onStartImmediately,
  bucketGallery,
  onOpenPresets,
  config,
}: {
  catalog: ResearchStrategyOption[];
  selection: string | null;
  onSelection: (id: string) => void;
  selectionAttention: number;
  presetName: string;
  hasBandPreset: boolean;
  startImmediately: boolean;
  onStartImmediately: (value: boolean) => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
  config: TrackDialogConfig;
}) {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">{config.pickerTitle}</span>
        <StrategyPicker
          strategies={catalog}
          value={selection}
          onChange={onSelection}
          groupName={config.pickerGroup}
          attentionSignal={selectionAttention}
          noun={config.pickerNoun}
          legend={config.pickerLegend}
        />
      </div>
      <AgentConfigBox
        lines={[`${config.bandVerb} ${presetName}${hasBandPreset ? "" : " (board default)"}`]}
        onConfigure={onOpenPresets}
      />
      <StartImmediatelyCheck checked={startImmediately} onChange={onStartImmediately} onViewBucket={bucketGallery.openBucketGallery} />
      {bucketGallery.bucketGallery}
    </div>
  );
}

export type CreateTrackDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: string | null;
  validProjectIds?: string[];
  catalog: ResearchStrategyOption[];
  preset: TrackPreset;
  hasBandPreset: boolean;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: React.ReactNode };
  onOpenPresets: () => void;
  config: TrackDialogConfig;
};

export function CreateTrackDialog({
  open,
  onOpenChange,
  activeProjectId,
  validProjectIds,
  catalog,
  preset,
  hasBandPreset,
  bucketGallery,
  onOpenPresets,
  config,
}: CreateTrackDialogProps) {
  const { seedProjectId, openChange, submitWithMemory } = useProjectSeed({ activeProjectId, validProjectIds });
  const submit = useCreateTrackSubmit({ activeProjectId: seedProjectId, onClose: () => onOpenChange(false), config });
  const seededEnvironment = useSeededComposerEnvironment(preset?.environmentKind, open);

  return (
    <CreateCardDialogShell
      open={open}
      onOpenChange={(next) => openChange(next, onOpenChange, submit.resetOnOpen)}
      title={config.dialogTitle}
      description={config.dialogDescription}
      error={submit.error}
    >
        <CreateTrackSettings
          catalog={catalog}
          selection={submit.selection}
          onSelection={submit.setSelection}
          selectionAttention={submit.selectionAttention}
          presetName={preset?.name ?? "Default"}
          hasBandPreset={hasBandPreset}
          startImmediately={submit.startImmediately}
          onStartImmediately={submit.setStartImmediately}
          bucketGallery={bucketGallery}
          onOpenPresets={onOpenPresets}
          config={config}
        />
        <CreateCardComposer
          seedProjectId={seedProjectId}
          preset={preset}
          seededEnvironment={seededEnvironment}
          prompt={submit.prompt}
          placeholder={config.placeholder}
          draftKey={config.draftKey}
          onSubmit={(request) => submitWithMemory(request, submit.start)}
        />
    </CreateCardDialogShell>
  );
}
