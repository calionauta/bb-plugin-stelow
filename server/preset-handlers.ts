import type { PresetAccessors } from "./preset-accessors.js";
import type { PresetServerDeps } from "./preset-contracts.js";
import { createPresetAssignmentHandlers } from "./preset-handler-assignments.js";
import { createPresetCrudHandlers } from "./preset-handler-crud.js";

type SingletonInput = { presetId: string | null };

export function refreshReliablePresetWorkers(
  table: string,
  accessors: PresetAccessors,
): void {
  if (table === "reliable_preset") accessors.refreshLiveWorkers(null);
}

export function createPresetHandlers(
  deps: PresetServerDeps,
  accessors: PresetAccessors,
) {
  const crud = createPresetCrudHandlers(deps, accessors);
  const assignments = createPresetAssignmentHandlers(
    deps,
    accessors,
    refreshReliablePresetWorkers,
  );
  const { designate, ...assignmentHandlers } = assignments;
  return {
    ...crud,
    ...assignmentHandlers,
    assignReliablePreset: async ({ presetId }: SingletonInput) =>
      designate("reliable_preset", presetId),
  };
}
