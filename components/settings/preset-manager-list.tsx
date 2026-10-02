import { Button } from "@/components/ui/button";
import { PresetManagerPresetRow } from "./preset-manager-preset-row";
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
          <PresetManagerPresetRow
            key={preset.id}
            preset={preset}
            busy={busy}
            onEdit={onEdit}
            onSetDefault={onSetDefault}
            onDelete={onDelete}
          />
        ))}
      </div>
    </>
  );
}