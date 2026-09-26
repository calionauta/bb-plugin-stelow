/**
 * The props both routing sections take. Band routing and delegated work edit the
 * same three role presets and the same band table, so they take the same
 * thirteen props — and assembling them once is the point: a section that grew a
 * fourteenth prop fails here, at the one call site, rather than at a second one
 * that quietly forgot to pass it. It lives in its own module, apart from the
 * component that renders it, so the wiring can be asserted without rendering.
 */
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { PresetManagerAssignments } from "./preset-manager-assignments";
import type { PresetManagerPreset } from "./preset-manager-types";

type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export type PresetManagerRoutingProps = {
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>;
  presets: PresetManagerPreset[];
  bands: PresetManagerAssignments["bands"];
  reliablePreset: PresetManagerAssignments["reliablePreset"];
  generationPreset: PresetManagerAssignments["generationPreset"];
  reviewerPreset: PresetManagerAssignments["reviewerPreset"];
  busy: boolean;
  onChanged: () => Promise<void>;
  onBandsChange: PresetManagerAssignments["setBands"];
  onMessage: (message: string | null) => void;
  onBusyChange: (busy: boolean) => void;
  onReliableChange: PresetManagerAssignments["setReliablePreset"];
  onGenerationChange: PresetManagerAssignments["setGenerationPreset"];
  onReviewerChange: PresetManagerAssignments["setReviewerPreset"];
};

export function presetManagerRouting(
  rpc: ManagerRpc,
  presets: PresetManagerPreset[],
  assignments: PresetManagerAssignments,
  crud: {
    busy: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: string | null) => void;
  },
  onChanged: () => Promise<void>,
): PresetManagerRoutingProps {
  return {
    rpc,
    presets,
    bands: assignments.bands,
    reliablePreset: assignments.reliablePreset,
    generationPreset: assignments.generationPreset,
    reviewerPreset: assignments.reviewerPreset,
    busy: crud.busy,
    onChanged,
    onBandsChange: assignments.setBands,
    onMessage: crud.setMessage,
    onBusyChange: crud.setBusy,
    onReliableChange: assignments.setReliablePreset,
    onGenerationChange: assignments.setGenerationPreset,
    onReviewerChange: assignments.setReviewerPreset,
  };
}
