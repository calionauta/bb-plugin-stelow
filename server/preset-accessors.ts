import { createPresetAssignmentAccessors } from "./preset-assignments.js";
import { createPresetLookupAccessors, createPresetSelectionAccessors } from "./preset-lookups.js";
import { createPresetWorkerAccessors } from "./preset-workers.js";
import type { PresetDb } from "./preset-contracts.js";

export function createPresetAccessors(db: PresetDb, now: () => number) {
  const lookups = createPresetLookupAccessors(db, now);
  const selections = createPresetSelectionAccessors(db, lookups);
  const assignments = createPresetAssignmentAccessors(db, now, lookups);
  const workers = createPresetWorkerAccessors(db, selections);
  return {
    ...lookups,
    ...selections,
    ...assignments,
    ...workers,
  };
}

export type PresetAccessors = ReturnType<typeof createPresetAccessors>;
