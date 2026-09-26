import { useCallback, useEffect, useState } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { BandPresetEntry } from "./preset-manager-types";

type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
export type AssignedPreset = { id: string; name: string } | null;

export type PresetManagerAssignments = {
  bands: BandPresetEntry[];
  setBands: React.Dispatch<React.SetStateAction<BandPresetEntry[]>>;
  generationPreset: AssignedPreset;
  setGenerationPreset: (preset: AssignedPreset) => void;
  reliablePreset: AssignedPreset;
  setReliablePreset: (preset: AssignedPreset) => void;
  reviewerPreset: AssignedPreset;
  setReviewerPreset: (preset: AssignedPreset) => void;
};

/**
 * Everything the dialog loads when it opens: the per-band routing table and the
 * three presets the roles resolve to. All four are reads of the same server
 * state and all four are re-read on every open, so they are loaded together —
 * and each read fails soft to "none", because a role with no preset is a normal
 * state and not a reason to leave the section blank with an error.
 */
export function usePresetManagerAssignments(rpc: ManagerRpc, open: boolean): PresetManagerAssignments {
  const [bands, setBands] = useState<BandPresetEntry[]>([]);
  const [generationPreset, setGenerationPreset] = useState<AssignedPreset>(null);
  const [reliablePreset, setReliablePreset] = useState<AssignedPreset>(null);
  const [reviewerPreset, setReviewerPreset] = useState<AssignedPreset>(null);
  const reloadGeneration = useCallback(() => {
    void rpc
      .call("getGenerationPreset", {})
      .then((result) => setGenerationPreset(result.preset))
      .catch(() => setGenerationPreset(null));
  }, [rpc]);
  const reloadReliable = useCallback(() => {
    void rpc
      .call("getReliablePreset", {})
      .then((result) => setReliablePreset(result.preset))
      .catch(() => setReliablePreset(null));
  }, [rpc]);
  const reloadReviewer = useCallback(() => {
    void rpc
      .call("getReviewPreset", {})
      .then((result) => setReviewerPreset(result.preset))
      .catch(() => setReviewerPreset(null));
  }, [rpc]);

  useEffect(() => {
    if (!open) return;
    void rpc
      .call("listBandPresets", {})
      .then((result) => setBands(result.bands))
      .catch(() => setBands([]));
    reloadGeneration();
    reloadReliable();
    reloadReviewer();
  }, [open, rpc, reloadGeneration, reloadReliable, reloadReviewer]);

  return {
    bands, setBands,
    generationPreset, setGenerationPreset,
    reliablePreset, setReliablePreset,
    reviewerPreset, setReviewerPreset,
  };
}
