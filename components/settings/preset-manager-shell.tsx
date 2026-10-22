import { useEffect, useRef } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { usePresetManagerAssignments } from "./preset-manager-assignments";
import { PresetManagerApiSections } from "./preset-manager-api-sections";
import { usePresetManagerCrud } from "./preset-manager-crud";
import { PresetManagerDeleteConfirm } from "./preset-manager-delete-confirm";
import { PresetManagerEditor } from "./preset-manager-editor";
import { presetManagerRouting } from "./preset-manager-routing-props";
import { PresetManagerRoutingSections } from "./preset-manager-routing-sections";
import type { PresetManagerPreset } from "./preset-manager-types";

type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

type PresetManagerDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  rpc: ManagerRpc;
  presets: PresetManagerPreset[];
  onChanged: () => Promise<void>;
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
          onDelete={(preset) => crud.requestDelete(preset)}
          onToggleForm={() => crud.setFormOpen((current) => !current)}
          onChange={crud.setForm}
          onSave={() => void crud.save()}
          onClose={() => onOpenChange(false)}
        />
        <PresetManagerDeleteConfirm crud={crud} assignments={assignments} />
        <PresetManagerRoutingSections routing={routing} />
        <PresetManagerApiSections rpc={rpc} />
      </DialogContent>
    </Dialog>
  );
}
