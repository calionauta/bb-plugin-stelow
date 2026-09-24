import { createPresetAccessors } from "./preset-accessors.js";
import { createPresetHandlers } from "./preset-handlers.js";
import type { PresetServerDeps } from "./preset-contracts.js";

export { PRESET_MIGRATION_STATEMENTS, runPresetMigrations } from "./preset-migrations.js";
export type {
  PresetAttachmentParams,
  PresetRow,
  PresetUpsertInput,
} from "./preset-contracts.js";

export function createPresetServer(deps: PresetServerDeps) {
  const accessors = createPresetAccessors(deps.db, deps.now);
  return {
    ...accessors,
    handlers: createPresetHandlers(deps, accessors),
  };
}
