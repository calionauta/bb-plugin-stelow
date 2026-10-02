import { Button } from "@/components/ui/button";
import {
  PresetManagerFormBody,
  PresetManagerFormToggle,
} from "./preset-manager-form-body";
import type { PresetManagerForm } from "./preset-manager-types";

type PresetManagerFormProps = {
  form: PresetManagerForm;
  builtIn: boolean;
  formOpen: boolean;
  busy: boolean;
  message: string | null;
  formRef: React.RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onNew: () => void;
  onChange: (next: PresetManagerForm) => void;
  onSave: () => void;
  onClose: () => void;
};

export function PresetManagerFormView({
  form,
  builtIn,
  formOpen,
  busy,
  message,
  formRef,
  onToggle,
  onNew,
  onChange,
  onSave,
  onClose,
}: PresetManagerFormProps) {
  return (
    <div ref={formRef} className="mt-3 rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {form.id ? `Edit ${form.name}` : "New preset"}
        </h4>
        <div className="flex shrink-0 gap-1">
          {form.id ? (
            <Button size="sm" variant="ghost" onClick={onNew}>
              New preset
            </Button>
          ) : null}
          <PresetManagerFormToggle open={formOpen} onToggle={onToggle} />
        </div>
      </div>
      {formOpen ? (
        <PresetManagerFormBody
          form={form}
          builtIn={builtIn}
          busy={busy}
          message={message}
          onChange={onChange}
          onSave={onSave}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}
