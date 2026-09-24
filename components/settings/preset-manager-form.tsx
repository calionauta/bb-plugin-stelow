import { DisclosureChevron } from "../disclosure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PresetExecutionPicker } from "./preset-execution-picker";
import type { PresetManagerForm } from "./preset-manager-types";

type PresetManagerFormProps = {
  form: PresetManagerForm;
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
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={formOpen}
            aria-controls="preset-form-body"
            onClick={onToggle}
            title={
              formOpen ? "Collapse the preset form" : "Expand the preset form"
            }
          >
            <DisclosureChevron open={formOpen} />
            {formOpen ? "Hide" : "Show"}
          </Button>
        </div>
      </div>
      {formOpen ? (
        <div id="preset-form-body">
          <div className="grid gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Name</span>
              <Input
                value={form.name}
                onChange={(event) =>
                  onChange({ ...form, name: event.target.value })
                }
                placeholder="e.g. Default"
              />
            </label>
            <PresetExecutionPicker
              value={form}
              onChange={(next) => onChange({ ...form, ...next })}
            />
          </div>
          {message ? (
            <p className="mt-2 text-xs text-muted-foreground">{message}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" disabled={busy} onClick={onSave}>
              {busy ? "Working…" : form.id ? "Save changes" : "Create preset"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
