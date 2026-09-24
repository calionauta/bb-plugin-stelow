import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { runPresetAssignment } from "../../lib/preset-assignment.mjs";
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

type PresetActionContext = {
  rpc: Rpc;
  cardId: string;
  customValue: PresetExecutionValue;
  defaultPreset: PresetSummary | null;
  complete: (message: string) => void;
  setError: (message: string | null) => void;
};

function recordAssignmentResult(
  result: { ok: boolean; error?: string },
  mode: "reset" | "override",
  complete: (message: string) => void,
  setError: (message: string | null) => void,
) {
  if (result.ok) {
    complete(mode === "reset" ? RESET_SUCCESS : OVERRIDE_SUCCESS);
    return;
  }
  const fallback = mode === "reset"
    ? "Could not reset preset."
    : "Could not change preset.";
  setError(result.error ?? fallback);
}

async function applyPresetSelection(
  context: PresetActionContext,
  selected: string | null,
) {
  const assignment = await runPresetAssignment({
    rpc: context.rpc,
    cardId: context.cardId,
    selected,
    customValue: context.customValue,
    defaultPreset: context.defaultPreset,
  });
  if (assignment.kind === "idle") return;
  if (assignment.kind === "invalid") {
    context.setError("Pick a provider and type a model id.");
    return;
  }
  recordAssignmentResult(
    assignment.result,
    assignment.mode,
    context.complete,
    context.setError,
  );
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
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await applyPresetSelection(
        { rpc, cardId, customValue, defaultPreset, complete, setError },
        selected,
      );
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, apply };
}

type PresetAssignDialogViewProps = PresetAssignDialogProps & {
  presets: PresetSummary[];
  catalog: ProviderCatalog;
  selected: string | null;
  customValue: PresetExecutionValue;
  custom: typeof EMPTY_CUSTOM;
  busy: boolean;
  error: string | null;
  onCustomChange: (value: PresetExecutionValue) => void;
  onSelect: (value: string) => void;
  onApply: () => void;
};

function PresetAssignDialogView(props: PresetAssignDialogViewProps) {
  const {
    open,
    onOpenChange,
    presets,
    catalog,
    selected,
    customValue,
    custom,
    busy,
    error,
    onCustomChange,
    onSelect,
    onApply,
  } = props;
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
          customValue={customValue}
          onCustomChange={onCustomChange}
          onSelect={onSelect}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button
            disabled={busy || !selected || (
              selected === "custom" &&
              (!custom.providerId || !custom.modelId.trim())
            )}
            onClick={onApply}
          >
            {busy ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PresetAssignDialog(props: PresetAssignDialogProps) {
  const { open, cardId, onChanged } = props;
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
    onOpenChange: props.onOpenChange,
    onChanged,
  });

  useEffect(() => {
    if (!open) return;
    setSelected(null);
  }, [open]);

  return (
    <PresetAssignDialogView
      {...props}
      presets={presets}
      catalog={catalog}
      selected={selected}
      customValue={custom.value}
      custom={custom.custom}
      busy={actions.busy}
      error={actions.error}
      onCustomChange={(next) => {
        custom.setCustom(next);
        setSelected("custom");
      }}
      onSelect={setSelected}
      onApply={() => void actions.apply()}
    />
  );
}
