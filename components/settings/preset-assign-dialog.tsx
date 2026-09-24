import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import {
  classifyPresetSelection,
  type PresetSelection,
} from "../../lib/preset-assignment.mjs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PresetAssignOptions,
  type PresetExecutionValue,
  type PresetSummary,
  type ProviderCatalog,
} from "./preset-assign-options";

const OVERRIDE_SUCCESS =
  "Preset overridden for this card. Resume only continues the current worker — " +
  "use Restart worker to switch to the new preset now.";
const RESET_SUCCESS = "Preset reset to board default.";
const EMPTY_CUSTOM = {
  providerId: "",
  modelId: "",
  reasoningLevel: "",
  permissionMode: "",
};

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type PermissionMode = "accept-edits" | "auto" | "full";
type PresetAssignDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  cardId: string;
  onChanged: () => void;
};

type CustomPresetRequest = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: PermissionMode;
  environmentKind: "project-default" | "new-worktree";
};
type CustomChoice = Exclude<PresetSelection, { kind: "default" } | { kind: "preset" }>;

function usePresetOptions(open: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalog>({
    providers: [],
    models: [],
  });

  useEffect(() => {
    if (!open) return;
    void rpc.call("listPresets", {})
      .then((result) => setPresets(result.presets))
      .catch(() => setPresets([]));
    void rpc.call("listProviderModels", {})
      .then(setCatalog)
      .catch(() => setCatalog({ providers: [], models: [] }));
  }, [open, rpc]);

  return { presets, catalog };
}

function useCustomPreset(
  open: boolean,
  defaultPreset: PresetSummary | null,
): {
  custom: typeof EMPTY_CUSTOM;
  value: PresetExecutionValue;
  setCustom: (value: typeof EMPTY_CUSTOM) => void;
} {
  const [custom, setCustom] = useState({ ...EMPTY_CUSTOM });
  useEffect(() => {
    if (open) setCustom({ ...EMPTY_CUSTOM });
  }, [open]);

  const defaultExecution = {
    reasoningLevel: defaultPreset?.reasoningLevel || "medium",
    permissionMode: (defaultPreset?.permissionMode || "full") as PermissionMode,
  };
  const value: PresetExecutionValue = {
    providerId: custom.providerId || defaultPreset?.providerId || "",
    modelId: custom.modelId || defaultPreset?.modelId || "",
    reasoningLevel: custom.reasoningLevel || defaultExecution.reasoningLevel,
    permissionMode: (custom.permissionMode || defaultExecution.permissionMode) as PermissionMode,
  };
  return { custom, value, setCustom };
}

async function assignExistingPreset(
  rpc: Rpc,
  cardId: string,
  presetId: string | null,
) {
  return rpc.call("assignPreset", { cardId, presetId });
}

async function assignCustomPreset(
  rpc: Rpc,
  cardId: string,
  request: CustomPresetRequest,
) {
  const upserted = await rpc.call("upsertPreset", {
    id: `card-override-${cardId}`,
    name: `Card override ${cardId}`,
    ...request,
  });
  return assignExistingPreset(rpc, cardId, upserted.preset.id);
}

function customPresetRequest(
  choice: CustomChoice,
  customValue: PresetExecutionValue,
  defaultPreset: PresetSummary | null,
): CustomPresetRequest | null {
  const value = choice.kind === "model"
    ? {
        providerId: choice.providerId,
        modelId: choice.modelId,
        reasoningLevel: defaultPreset?.reasoningLevel || "medium",
        permissionMode: (defaultPreset?.permissionMode || "full") as PermissionMode,
      }
    : {
        ...customValue,
        modelId: customValue.modelId.trim(),
      };
  if (!value.providerId || !value.modelId) return null;
  return {
    ...value,
    environmentKind: (defaultPreset?.environmentKind ?? "project-default") as
      | "project-default"
      | "new-worktree",
  };
}

function recordAssignmentResult(
  result: Awaited<ReturnType<typeof assignExistingPreset>>,
  fallback: string,
  success: string,
  finish: (message: string) => void,
  setError: (message: string | null) => void,
) {
  if (result.ok) finish(success);
  else setError(result.error ?? fallback);
}

function usePresetActions({
  open,
  cardId,
  selected,
  customValue,
  defaultPreset,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  cardId: string;
  selected: string | null;
  customValue: PresetExecutionValue;
  defaultPreset: PresetSummary | null;
  onOpenChange: (next: boolean) => void;
  onChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
  }, [open]);

  function complete(message: string) {
    onOpenChange(false);
    onChanged();
    toast.success(message);
  }

  async function apply() {
    const choice = classifyPresetSelection(selected);
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      if (choice.kind === "model" || choice.kind === "custom") {
        const request = customPresetRequest(choice, customValue, defaultPreset);
        if (!request) {
          setError("Pick a provider and type a model id.");
          return;
        }
        const result = await assignCustomPreset(rpc, cardId, request);
        recordAssignmentResult(
          result,
          "Could not change preset.",
          OVERRIDE_SUCCESS,
          complete,
          setError,
        );
      } else {
        const presetId = choice.kind === "preset" ? choice.presetId : null;
        const result = await assignExistingPreset(rpc, cardId, presetId);
        const fallback = presetId ? "Could not change preset." : "Could not reset preset.";
        const success = presetId ? OVERRIDE_SUCCESS : RESET_SUCCESS;
        recordAssignmentResult(result, fallback, success, complete, setError);
      }
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, apply };
}

export function PresetAssignDialog({
  open,
  onOpenChange,
  cardId,
  onChanged,
}: PresetAssignDialogProps) {
  const { presets, catalog } = usePresetOptions(open);
  const [selected, setSelected] = useState<string | null>(null);
  const defaultPreset = presets.find((preset) => preset.isDefault) ?? null;
  const custom = useCustomPreset(open, defaultPreset);
  const actions = usePresetActions({
    open,
    cardId,
    selected,
    customValue: custom.value,
    defaultPreset,
    onOpenChange,
    onChanged,
  });

  useEffect(() => {
    if (!open) return;
    setSelected(null);
  }, [open]);

  const visibleError = actions.error;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agent preset for this card</DialogTitle>
          <DialogDescription>Takes effect when the worker (re)starts.</DialogDescription>
        </DialogHeader>
        <PresetAssignOptions
          open={open}
          presets={presets}
          catalog={catalog}
          selected={selected}
          customValue={custom.value}
          onCustomChange={(next) => {
            custom.setCustom(next);
            setSelected("custom");
          }}
          onSelect={setSelected}
        />
        {visibleError ? <p className="text-xs text-destructive">{visibleError}</p> : null}
        <DialogFooter>
          <Button
            disabled={actions.busy || !selected || (
              selected === "custom" &&
              (!custom.custom.providerId || !custom.custom.modelId.trim())
            )}
            onClick={() => void actions.apply()}
          >
            {actions.busy ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
