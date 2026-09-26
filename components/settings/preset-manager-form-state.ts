import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_PRESET_FORM,
  formFromPreset,
  type PresetManagerForm,
  type PresetManagerPreset,
} from "./preset-manager-types";

export type PresetFormState = {
  form: PresetManagerForm;
  setForm: React.Dispatch<React.SetStateAction<PresetManagerForm>>;
  formOpen: boolean;
  setFormOpen: React.Dispatch<React.SetStateAction<boolean>>;
  message: string | null;
  setMessage: (message: string | null) => void;
  startNew: () => void;
  startEdit: (preset: PresetManagerPreset) => void;
};

/**
 * The form's own state, including the one rule about when it resets. Every open
 * starts from the default preset's settings with no name, and the message from
 * whatever the human did last time is gone: a dialog that opens showing
 * yesterday's error reads as an error about now.
 */
export function usePresetFormState(presets: PresetManagerPreset[], open: boolean): PresetFormState {
  const [form, setForm] = useState<PresetManagerForm>(EMPTY_PRESET_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Read through a ref so the reset keys on `open` alone: a preset refresh
  // arriving while the human is mid-edit must not wipe what they are typing.
  const presetsRef = useRef(presets);
  presetsRef.current = presets;

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_PRESET_FORM);
      setFormOpen(false);
      return;
    }
    setForm(defaultForm(presetsRef.current));
    setMessage(null);
  }, [open]);

  return {
    form, setForm, formOpen, setFormOpen, message, setMessage,
    startNew: useCallback(() => openForm(defaultForm(presets), setForm, setFormOpen, setMessage), [presets]),
    startEdit: (preset: PresetManagerPreset) => {
      setForm(formFromPreset(preset));
      setFormOpen(true);
      setMessage(null);
    },
  };
}

export function openForm(
  form: PresetManagerForm,
  setForm: (form: PresetManagerForm) => void,
  setFormOpen: (open: boolean) => void,
  setMessage: (message: string | null) => void,
): void {
  setForm(form);
  setFormOpen(true);
  setMessage(null);
}

/** A new preset starts from the default's settings — the fields, not its name. */
export function defaultForm(presets: PresetManagerPreset[]): PresetManagerForm {
  const preset = presets.find((item) => item.isDefault) ?? presets[0] ?? null;
  return preset
    ? { ...formFromPreset(preset), id: null, name: "" }
    : EMPTY_PRESET_FORM;
}
