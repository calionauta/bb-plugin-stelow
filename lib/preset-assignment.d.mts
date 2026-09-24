export type PresetSelection =
  | { kind: "default" }
  | { kind: "custom" }
  | { kind: "preset"; presetId: string }
  | { kind: "model"; providerId: string; modelId: string };

export function classifyPresetSelection(
  selected: string | null,
): PresetSelection | null;

export type PresetExecutionValue = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: "accept-edits" | "auto" | "full";
};

export type PresetDefault = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
};

export type PresetAssignment =
  | { kind: "idle" }
  | { kind: "invalid" }
  | {
      kind: "assigned";
      mode: "reset" | "override";
      result: { ok: boolean; error?: string };
    };

export function runPresetAssignment(input: {
  rpc: {
    call(method: string, payload: unknown): Promise<any>;
  };
  cardId: string;
  selected: string | null;
  customValue: PresetExecutionValue;
  defaultPreset: PresetDefault | null;
}): Promise<PresetAssignment>;
