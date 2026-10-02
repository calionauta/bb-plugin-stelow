import { DisclosureChevron } from "../disclosure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PresetExecutionPicker } from "./preset-execution-picker";
import { PresetEnvironmentKindField } from "./preset-environment-kind-field";
import type { PresetManagerForm } from "./preset-manager-types";

export type PresetManagerFormBodyProps = {
  form: PresetManagerForm;
  /** Built-in presets keep their own environment, so the field is disabled. */
  builtIn: boolean;
  busy: boolean;
  message: string | null;
  onChange: (next: PresetManagerForm) => void;
  onSave: () => void;
  onClose: () => void;
};

/**
 * The open form body. Split out of `PresetManagerFormView` so the shell can
 * gain the environment-kind field without growing a function that already
 * sits at its recorded ceiling.
 *
 * It stays inside the existing open body: the repo's surface rule wants a
 * section to be a `SECTION_SURFACE` or a `DisclosureSection` with one tone,
 * not a new border, and this is the same form body it always was.
 */
export function PresetManagerFormBody({
  form,
  builtIn,
  busy,
  message,
  onChange,
  onSave,
  onClose,
}: PresetManagerFormBodyProps) {
  return (
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
        <PresetEnvironmentKindField
          form={form}
          builtIn={builtIn}
          busy={busy}
          onChange={onChange}
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
  );
}

/** The disclosure chevron toggle, shared by the shell and the body wrapper. */
export function PresetManagerFormToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-expanded={open}
      aria-controls="preset-form-body"
      onClick={onToggle}
      title={open ? "Collapse the preset form" : "Expand the preset form"}
    >
      <DisclosureChevron open={open} />
      {open ? "Hide" : "Show"}
    </Button>
  );
}
