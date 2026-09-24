import { useCallback, useEffect, useRef, useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { DecisionApiSection, DecisionRoutersSection } from "./decision-api";
import { DisclosureSection } from "../disclosure";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PresetManagerBandRouting,
  PresetManagerDelegatedWork,
} from "./preset-manager-band-routing";
import { PresetManagerFormView } from "./preset-manager-form";
import { PresetManagerList } from "./preset-manager-list";
import {
  EMPTY_PRESET_FORM,
  formFromPreset,
  type BandPresetEntry,
  type PresetManagerForm,
  type PresetManagerPreset,
} from "./preset-manager-types";

type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type AssignedPreset = { id: string; name: string } | null;

type PresetManagerDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  rpc: ManagerRpc;
  presets: PresetManagerPreset[];
  onChanged: () => Promise<void>;
};

function defaultForm(presets: PresetManagerPreset[]): PresetManagerForm {
  const preset = presets.find((item) => item.isDefault) ?? presets[0] ?? null;
  return preset
    ? { ...formFromPreset(preset), id: null, name: "" }
    : EMPTY_PRESET_FORM;
}

export function PresetManagerDialog({
  open,
  onOpenChange,
  rpc,
  presets,
  onChanged,
}: PresetManagerDialogProps) {
  const [form, setForm] = useState<PresetManagerForm>(EMPTY_PRESET_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [bands, setBands] = useState<BandPresetEntry[]>([]);
  const [generationPreset, setGenerationPreset] =
    useState<AssignedPreset>(null);
  const [reliablePreset, setReliablePreset] = useState<AssignedPreset>(null);
  const [reviewerPreset, setReviewerPreset] = useState<AssignedPreset>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const reloadGeneration = useCallback(() => {
    void rpc
      .call("getGenerationPreset", {})
      .then((result) => setGenerationPreset(result.preset))
      .catch(() => setGenerationPreset(null));
  }, [rpc]);
  const reloadReliable = useCallback(() => {
    void rpc
      .call("getReliablePreset", {})
      .then((result) => setReliablePreset(result.preset))
      .catch(() => setReliablePreset(null));
  }, [rpc]);
  const reloadReviewer = useCallback(() => {
    void rpc
      .call("getReviewPreset", {})
      .then((result) => setReviewerPreset(result.preset))
      .catch(() => setReviewerPreset(null));
  }, [rpc]);

  useEffect(() => {
    if (formOpen) formRef.current?.scrollIntoView({ block: "nearest" });
  }, [formOpen]);
  useEffect(() => {
    if (!open) {
      setForm(EMPTY_PRESET_FORM);
      setFormOpen(false);
      return;
    }
    setForm(defaultForm(presets));
    setMessage(null);
    void rpc
      .call("listBandPresets", {})
      .then((result) => setBands(result.bands))
      .catch(() => setBands([]));
    reloadGeneration();
    reloadReliable();
    reloadReviewer();
  }, [open, rpc, reloadGeneration, reloadReliable, reloadReviewer]);

  const startNew = () => {
    setForm(defaultForm(presets));
    setFormOpen(true);
    setMessage(null);
  };
  const startEdit = (preset: PresetManagerPreset) => {
    setForm(formFromPreset(preset));
    setFormOpen(true);
    setMessage(null);
  };
  const save = async () => {
    if (!form.name.trim()) {
      setMessage("Name is required.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("upsertPreset", {
        id: form.id,
        name: form.name.trim(),
        providerId: form.providerId,
        modelId: form.modelId,
        reasoningLevel: form.reasoningLevel,
        permissionMode: form.permissionMode,
        environmentKind: form.environmentKind,
        baseBranch: null,
        machineId: null,
        instructions: "",
      });
      setForm((current) => ({ ...current, id: result.preset.id }));
      setMessage(`Saved ${result.preset.name}.`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (preset: PresetManagerPreset) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("deletePreset", { id: preset.id });
      setMessage(result.error ?? `Removed ${preset.name}.`);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  const setDefault = async (preset: PresetManagerPreset) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("setDefaultPreset", { id: preset.id });
      setMessage(result.error ?? `${preset.name} is now the default.`);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullscreenOnMobile
        className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>Manage agent presets</DialogTitle>
          <DialogDescription>
            Presets set the provider, model, reasoning level, and permission
            mode used when a card starts its worker thread. Research
            investigations use the research phase preset.
          </DialogDescription>
        </DialogHeader>
        <PresetManagerList
          presets={presets}
          busy={busy}
          onNew={startNew}
          onEdit={startEdit}
          onSetDefault={(preset) => void setDefault(preset)}
          onDelete={(preset) => void remove(preset)}
        />
        <PresetManagerFormView
          form={form}
          formOpen={formOpen}
          busy={busy}
          message={message}
          formRef={formRef}
          onToggle={() => setFormOpen((current) => !current)}
          onNew={startNew}
          onChange={setForm}
          onSave={() => void save()}
          onClose={() => onOpenChange(false)}
        />
        <DisclosureSection
          title="Worker preset per track"
          hint="phase routing"
          defaultOpen={false}
        >
          <p className="mb-2 text-xs text-muted-foreground">
            Each track runs on its own preset. Build phases can each override
            it; the worker switches automatically at phase boundaries. Unset
            rows fall back to the card preset (or default).
          </p>
          <PresetManagerBandRouting
            rpc={rpc}
            presets={presets}
            bands={bands}
            reliablePreset={reliablePreset}
            generationPreset={generationPreset}
            reviewerPreset={reviewerPreset}
            busy={busy}
            onChanged={onChanged}
            onBandsChange={setBands}
            onMessage={setMessage}
            onBusyChange={setBusy}
            onReliableChange={setReliablePreset}
            onGenerationChange={setGenerationPreset}
            onReviewerChange={setReviewerPreset}
          />
        </DisclosureSection>
        <DisclosureSection
          title="Delegated work"
          hint="subagent tiers"
          defaultOpen={false}
        >
          <p className="mb-2 text-xs text-muted-foreground">
            Work the host delegates to subthreads. Empty selects revert to the
            band preset — except Review, where empty means no reviewer.
          </p>
          <PresetManagerDelegatedWork
            rpc={rpc}
            presets={presets}
            bands={bands}
            reliablePreset={reliablePreset}
            generationPreset={generationPreset}
            reviewerPreset={reviewerPreset}
            busy={busy}
            onChanged={onChanged}
            onBandsChange={setBands}
            onMessage={setMessage}
            onBusyChange={setBusy}
            onReliableChange={setReliablePreset}
            onGenerationChange={setGenerationPreset}
            onReviewerChange={setReviewerPreset}
          />
        </DisclosureSection>
        <DisclosureSection
          title="Decision API"
          hint="Jev-compatible"
          defaultOpen={false}
        >
          <DecisionApiSection rpc={rpc} />
        </DisclosureSection>
        <DisclosureSection
          title="Decision routers"
          hint="per-judgment modes"
          defaultOpen={false}
        >
          <DecisionRoutersSection rpc={rpc} />
        </DisclosureSection>
      </DialogContent>
    </Dialog>
  );
}
