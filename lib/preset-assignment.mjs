import { storableEnvironmentKind } from "./preset-environment-seed.mjs";

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

function customRequest(choice, customValue, defaultPreset) {
  const value = choice.kind === "model"
    ? {
        providerId: choice.providerId,
        modelId: choice.modelId,
        reasoningLevel: defaultPreset?.reasoningLevel || "medium",
        permissionMode: defaultPreset?.permissionMode || "full",
      }
    : { ...customValue, modelId: customValue.modelId.trim() };
  if (!value.providerId || !value.modelId) return null;
  return {
    ...value,
    // The card-override path forwards a kind on the same reachability the
    // editor argues for: upgraded installs add the column with no CHECK and the
    // CLI casts its flag blindly, so a value outside the enum is genuinely
    // reachable here too. Validated rather than passed through, because this
    // path has no form to refuse in — the raw zod string would surface as a
    // failed assignment with nothing the reader can act on.
    environmentKind: storableEnvironmentKind(defaultPreset?.environmentKind),
  };
}

export async function runPresetAssignment({
  rpc,
  cardId,
  selected,
  customValue,
  defaultPreset,
}) {
  const choice = classifyPresetSelection(selected);
  if (!choice) return { kind: "idle" };
  if (choice.kind === "model" || choice.kind === "custom") {
    const request = customRequest(choice, customValue, defaultPreset);
    if (!request) return { kind: "invalid" };
    const upserted = await rpc.call("upsertPreset", {
      id: `card-override-${cardId}`,
      name: `Card override ${cardId}`,
      ...request,
    });
    const result = await rpc.call("assignPreset", {
      cardId,
      presetId: upserted.preset.id,
    });
    return { kind: "assigned", mode: "override", result };
  }
  const presetId = choice.kind === "preset" ? choice.presetId : null;
  const result = await rpc.call("assignPreset", { cardId, presetId });
  return {
    kind: "assigned",
    mode: presetId ? "override" : "reset",
    result,
  };
}
