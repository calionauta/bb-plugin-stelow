import { useEffect, useRef, useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { ConfirmActionDialog } from "../confirm-action-dialog";
import {
  describePresetDeleteImpact,
  presetDeleteDescription,
} from "../../lib/preset-delete-refs.mjs";
import {
  PresetManagerBandRouting,
  PresetManagerDelegatedWork,
} from "./preset-manager-band-routing";
import { usePresetManagerAssignments } from "./preset-manager-assignments";
import { PresetManagerApiSections } from "./preset-manager-api-sections";
import { usePresetManagerCrud } from "./preset-manager-crud";
import { PresetManagerEditor } from "./preset-manager-editor";
import { presetManagerRouting } from "./preset-manager-routing-props";
import { PresetManagerRoutingSection } from "./preset-manager-routing-section";
import type { PresetManagerPreset } from "./preset-manager-types";

type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

type PresetManagerDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  rpc: ManagerRpc;
  presets: PresetManagerPreset[];
  onChanged: () => Promise<void>;
};

const BAND_ROUTING = {
  title: "Worker preset per track",
  hint: "phase routing",
  explanation: "Each track runs on its own preset. Build phases can each override it; "
    + "the worker switches automatically at phase boundaries. Unset rows fall back to "
    + "the card preset (or default).",
};

const DELEGATED_WORK = {
  title: "Delegated work",
  hint: "subagent tiers",
  explanation: "Work the host delegates to subthreads. Empty selects revert to the band "
    + "preset — except Review, where empty means no reviewer.",
};

export function PresetManagerDialog({
  open,
  onOpenChange,
  rpc,
  presets,
  onChanged,
}: PresetManagerDialogProps) {
  const crud = usePresetManagerCrud({ rpc, presets, onChanged, open });
  const assignments = usePresetManagerAssignments(rpc, open);
  const formRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PresetManagerPreset | null>(null);

  useEffect(() => {
    if (crud.formOpen) formRef.current?.scrollIntoView({ block: "nearest" });
  }, [crud.formOpen]);

  const routing = presetManagerRouting(rpc, presets, assignments, crud, onChanged);

  // The confirm names what the delete takes with it. Bands, roles and
  // default-ness are already loaded by the assignments hook; card pins are
  // not (no usage-count RPC exists), so those stay a post-confirm server
  // message rather than a pre-confirm claim.
  const deleteImpact = pendingDelete
    ? describePresetDeleteImpact(pendingDelete.id, {
      bands: assignments.bands,
      generationPreset: assignments.generationPreset,
      reliablePreset: assignments.reliablePreset,
      reviewerPreset: assignments.reviewerPreset,
      isDefault: pendingDelete.isDefault,
    })
    : null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullscreenOnMobile
        className="overflow-y-auto sm:max-h-[calc(100dvh-1rem)] sm:max-w-xl"
      >
        <PresetManagerEditor
          presets={presets}
          busy={crud.busy}
          form={crud.form}
          formOpen={crud.formOpen}
          message={crud.message}
          formRef={formRef}
          onNew={crud.startNew}
          onEdit={crud.startEdit}
          onSetDefault={(preset) => void crud.setDefault(preset)}
          onDelete={(preset) => setPendingDelete(preset)}
          onToggleForm={() => crud.setFormOpen((current) => !current)}
          onChange={crud.setForm}
          onSave={() => void crud.save()}
          onClose={() => onOpenChange(false)}
        />
        <PresetManagerRoutingSection {...BAND_ROUTING} {...routing}>
          <PresetManagerBandRouting {...routing} />
        </PresetManagerRoutingSection>
        <PresetManagerRoutingSection {...DELEGATED_WORK} {...routing}>
          <PresetManagerDelegatedWork {...routing} />
        </PresetManagerRoutingSection>
        <PresetManagerApiSections rpc={rpc} />
      </DialogContent>
    </Dialog>
    <ConfirmActionDialog
      open={pendingDelete !== null}
      onOpenChange={(next) => {
        if (!next) setPendingDelete(null);
      }}
      title={pendingDelete ? `Delete preset "${pendingDelete.name}"?` : "Delete preset?"}
      description={
        pendingDelete && deleteImpact
          ? presetDeleteDescription(pendingDelete.name, deleteImpact)
          : "Removes this agent preset."
      }
      confirmLabel="Delete preset"
      confirmTone="destructive"
      onConfirm={() => {
        const target = pendingDelete;
        setPendingDelete(null);
        if (target) void crud.remove(target);
      }}
    />
    </>
  );
}
