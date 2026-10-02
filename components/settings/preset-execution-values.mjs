// The reasoning-level vocabulary is owned by lib/ so the server can validate
// the same eight values at its write boundary; this module re-exports it for
// the pickers and keeps the genuinely UI-only helpers.
export {
  asPresetReasoningLevel,
  PRESET_REASONING_LEVELS,
} from "../../lib/preset-reasoning-level.mjs";

export function modeLabel(mode) {
  if (mode === "api") return "Decision API";
  if (mode === "preset") return "Preset judge";
  return "Built-in rules (default)";
}
