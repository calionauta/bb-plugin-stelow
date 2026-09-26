import type { RefObject } from "react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PresetManagerFormView } from "./preset-manager-form";
import { PresetManagerList } from "./preset-manager-list";
import type { PresetManagerForm, PresetManagerPreset } from "./preset-manager-types";

export type PresetManagerEditorProps = {
  presets: PresetManagerPreset[];
  busy: boolean;
  form: PresetManagerForm;
  formOpen: boolean;
  message: string | null;
  formRef: RefObject<HTMLDivElement | null>;
  onNew: () => void;
  onEdit: (preset: PresetManagerPreset) => void;
  onSetDefault: (preset: PresetManagerPreset) => void;
  onDelete: (preset: PresetManagerPreset) => void;
  onToggleForm: () => void;
  onChange: (form: PresetManagerForm) => void;
  onSave: () => void;
  onClose: () => void;
};

/**
 * What the dialog is for: the presets that exist, and the form that edits one.
 * The header says the same thing as the list below it, so it lives with the list
 * rather than above the routing sections the human usually came for.
 */
export function PresetManagerEditor(props: PresetManagerEditorProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Manage agent presets</DialogTitle>
        <DialogDescription>
          Presets set the provider, model, reasoning level, and permission
          mode used when a card starts its worker thread. Research
          investigations use the research phase preset.
        </DialogDescription>
      </DialogHeader>
      <PresetManagerList
        presets={props.presets}
        busy={props.busy}
        onNew={props.onNew}
        onEdit={props.onEdit}
        onSetDefault={props.onSetDefault}
        onDelete={props.onDelete}
      />
      <PresetManagerFormView
        form={props.form}
        formOpen={props.formOpen}
        busy={props.busy}
        message={props.message}
        formRef={props.formRef}
        onToggle={props.onToggleForm}
        onNew={props.onNew}
        onChange={props.onChange}
        onSave={props.onSave}
        onClose={props.onClose}
      />
    </>
  );
}
