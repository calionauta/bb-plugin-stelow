export const PRESET_REASONING_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "none",
  "ultra",
  "ultracode",
];

export function asPresetReasoningLevel(value) {
  return PRESET_REASONING_LEVELS.includes(value) ? value : "medium";
}

export function modeLabel(mode) {
  if (mode === "api") return "Decision API";
  if (mode === "preset") return "Preset judge";
  return "Built-in rules (default)";
}
