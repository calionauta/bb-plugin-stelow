import { useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { usePresetFormState, type PresetFormState } from "./preset-manager-form-state";
import type { PresetManagerPreset } from "./preset-manager-types";

type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export type PresetManagerCrud = PresetFormState & {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  save: () => Promise<void>;
  remove: (preset: PresetManagerPreset) => Promise<void>;
  setDefault: (preset: PresetManagerPreset) => Promise<void>;
};

/**
 * The list's three actions. The message is one field on purpose — save, delete
 * and set-default all report into it, so the human reads the outcome of the last
 * thing they did in one place rather than in a toast they may have missed. The
 * form's own state lives in its own hook; this one owns what mutates the server.
 */
export function usePresetManagerCrud({
  rpc,
  presets,
  onChanged,
  open,
}: {
  rpc: ManagerRpc;
  presets: PresetManagerPreset[];
  onChanged: () => Promise<void>;
  open: boolean;
}): PresetManagerCrud {
  const form = usePresetFormState(presets, open);
  const [busy, setBusy] = useState(false);

  return {
    ...form,
    busy, setBusy,
    save: () => savePreset(rpc, { state: form, setBusy, setMessage: form.setMessage, onChanged }),
    remove: (preset: PresetManagerPreset) => runPresetAction(
      rpc, preset, "deletePreset", setBusy, form.setMessage, onChanged,
    ),
    setDefault: (preset: PresetManagerPreset) => runPresetAction(
      rpc, preset, "setDefaultPreset", setBusy, form.setMessage, onChanged,
    ),
  };
}

export async function savePreset(
  rpc: ManagerRpc,
  {
    state,
    setBusy,
    setMessage,
    onChanged,
  }: {
    state: PresetFormState;
    setBusy: (busy: boolean) => void;
    setMessage: (message: string | null) => void;
    onChanged: () => Promise<void>;
  },
): Promise<void> {
  if (!state.form.name.trim()) {
    setMessage("Name is required.");
    return;
  }
  setBusy(true);
  setMessage(null);
  try {
    const result = await rpc.call("upsertPreset", {
      id: state.form.id,
      name: state.form.name.trim(),
      providerId: state.form.providerId,
      modelId: state.form.modelId,
      reasoningLevel: state.form.reasoningLevel,
      permissionMode: state.form.permissionMode,
      environmentKind: state.form.environmentKind,
      baseBranch: null,
      machineId: null,
      instructions: "",
    });
    // The saved id is what makes the next save an update rather than a copy.
    state.setForm((current) => ({ ...current, id: result.preset.id }));
    setMessage(`Saved ${result.preset.name}.`);
    await onChanged();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Save failed.");
  } finally {
    setBusy(false);
  }
}

/**
 * Delete and set-default share one body because they share one contract: a
 * refusal comes back as `error` on a successful call, so a refused delete must
 * not be reported as a success.
 */
export async function runPresetAction(
  rpc: ManagerRpc,
  preset: PresetManagerPreset,
  call: "deletePreset" | "setDefaultPreset",
  setBusy: (busy: boolean) => void,
  setMessage: (message: string | null) => void,
  onChanged: () => Promise<void>,
): Promise<void> {
  setBusy(true);
  setMessage(null);
  try {
    const result = await rpc.call(call, { id: preset.id });
    setMessage(result.error ?? (call === "deletePreset"
      ? `Removed ${preset.name}.`
      : `${preset.name} is now the default.`));
    await onChanged();
  } finally {
    setBusy(false);
  }
}
