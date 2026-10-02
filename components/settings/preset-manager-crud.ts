import { useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { usePresetFormState, type PresetFormState } from "./preset-manager-form-state";
import { asPresetReasoningLevel } from "./preset-execution-values.mjs";
import {
  ENVIRONMENT_KINDS,
  isKnownEnvironmentKind,
} from "./preset-environment-kind.mjs";
import type {
  PresetManagerForm,
  PresetManagerPreset,
} from "./preset-manager-types";

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

/**
 * What the save refuses, in the reader's words, or null when it may proceed.
 *
 * The environment is checked here rather than at the schema: the RPC's zod enum
 * turns an out-of-enum kind into a raw validation string, and this form's one
 * message line is no place for that. An installed row can genuinely hold such a
 * value — upgraded installs add the column with `ALTER TABLE` and no CHECK — so
 * this is a reachable state, not a theoretical one.
 */
function saveRefusal(form: PresetManagerForm): string | null {
  if (!form.name.trim()) return "Name is required.";
  if (isKnownEnvironmentKind(form.environmentKind)) return null;
  return `Environment "${form.environmentKind}" is not one this dialog can set. `
    + "Choose the isolated worktree option, or turn it off to use BB's default.";
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
  const refusal = saveRefusal(state.form);
  if (refusal) {
    setMessage(refusal);
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
      reasoningLevel: asPresetReasoningLevel(state.form.reasoningLevel),
      permissionMode: state.form.permissionMode,
      // Narrowed by the refusal above, which is what makes the cast safe here
      // and not a way around it: the enum belongs to the RPC contract, while
      // the dialog carries a wider string so it can name an unrecognised value
      // instead of hiding it.
      environmentKind: state.form.environmentKind as (typeof ENVIRONMENT_KINDS)[number],
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
