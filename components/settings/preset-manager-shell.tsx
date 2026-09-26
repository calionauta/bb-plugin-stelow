import { useEffect, useRef } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
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

  useEffect(() => {
    if (crud.formOpen) formRef.current?.scrollIntoView({ block: "nearest" });
  }, [crud.formOpen]);

  const routing = presetManagerRouting(rpc, presets, assignments, crud, onChanged);

  return (
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
          onDelete={(preset) => void crud.remove(preset)}
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
  );
}
