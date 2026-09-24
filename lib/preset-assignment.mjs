const DEFAULT_SELECTION = "default";
const PRESET_PREFIX = "preset:";
const MODEL_PREFIX = "model:";

export function classifyPresetSelection(selected) {
  if (!selected) return null;
  if (selected === DEFAULT_SELECTION) return { kind: "default" };
  if (selected === "custom") return { kind: "custom" };
  if (selected.startsWith(PRESET_PREFIX)) {
    return {
      kind: "preset",
      presetId: selected.slice(PRESET_PREFIX.length),
    };
  }
  if (selected.startsWith(MODEL_PREFIX)) {
    const [providerId, ...modelParts] = selected.slice(MODEL_PREFIX.length).split("/");
    return {
      kind: "model",
      providerId: providerId ?? "",
      modelId: modelParts.join("/"),
    };
  }
  throw new Error(`Unsupported preset selection: ${selected}`);
}
