import { Pill } from "../dashboard/build-status-pills";
import { Button } from "@/components/ui/button";
import type { PresetManagerPreset } from "./preset-manager-types";

type PresetManagerListProps = {
  presets: PresetManagerPreset[];
  busy: boolean;
  onNew: () => void;
  onEdit: (preset: PresetManagerPreset) => void;
  onSetDefault: (preset: PresetManagerPreset) => void;
  onDelete: (preset: PresetManagerPreset) => void;
};

export function PresetManagerList({
  presets,
  busy,
  onNew,
  onEdit,
  onSetDefault,
  onDelete,
}: PresetManagerListProps) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Presets ({presets.length})</h3>
        <Button size="sm" variant="outline" disabled={busy} onClick={onNew}>
          New preset
        </Button>
      </div>
      <div className="max-h-56 space-y-1.5 overflow-auto pr-1">
        {presets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No presets yet. Create one below.
          </p>
        ) : null}
        {presets.map((preset) => (
          <div
            key={preset.id}
            className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{preset.name}</span>
              <span className="ml-2 text-muted-foreground">
                {preset.providerId}/{preset.modelId} · {preset.reasoningLevel} ·{" "}
                {preset.permissionMode}
              </span>
            </span>
            {preset.isDefault ? (
              <Pill tone="bg-primary/15 text-primary">default</Pill>
            ) : null}
            {preset.builtIn ? <Pill>built-in</Pill> : null}
            <div className="flex shrink-0 gap-1">
              {!preset.isDefault ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onSetDefault(preset)}
                >
                  Set default
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onEdit(preset)}
              >
                Edit
              </Button>
              {!preset.builtIn ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onDelete(preset)}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
