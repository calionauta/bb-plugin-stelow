import {
  experimental_PermissionModePicker as PermissionModePicker,
  experimental_ProviderModelPicker as ProviderModelPicker,
} from "@get-bb/plugin-sdk/app";
import { asPresetReasoningLevel } from "./preset-execution-values.mjs";

type PresetExecution = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: "accept-edits" | "auto" | "full";
};

type PresetExecutionPickerProps = {
  value: PresetExecution;
  onChange: (next: PresetExecution) => void;
};

export function PresetExecutionPicker({ value, onChange }: PresetExecutionPickerProps) {
  if (!value.providerId || !value.modelId) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        Pick or create a preset to configure its provider and model.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <ProviderModelPicker
        value={{
          providerId: value.providerId,
          model: value.modelId,
          reasoningLevel: asPresetReasoningLevel(value.reasoningLevel),
        }}
        onChange={(next) => onChange({
          ...value,
          providerId: next.providerId,
          modelId: next.model,
          reasoningLevel: next.reasoningLevel,
        })}
      />
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Permission mode</span>
        <PermissionModePicker
          providerId={value.providerId}
          value={value.permissionMode}
          onChange={(next) => onChange({ ...value, permissionMode: next })}
        />
      </label>
    </div>
  );
}
