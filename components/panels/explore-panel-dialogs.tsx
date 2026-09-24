import type { ReactNode } from "react";
import { CreateExploreDialog } from "../creation/create-explore-dialog";
import { STORAGE_KEYS } from "../../lib/panel-storage.mjs";
import type { ExplorePanelData, ExploreRpc } from "./explore-panel-state";

export type ExplorePresetManagerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rpc: ExploreRpc;
  presets: ExplorePanelData["presets"];
  onChanged: () => Promise<void>;
};

export type ExploreOnboardingProps = {
  storageKey: string;
  title: string;
  intro: string;
  onOpenPresets: () => void;
  active: boolean;
};

type Props = {
  active: boolean;
  projectId: string | null;
  data: ExplorePanelData;
  preset: { preset: ExplorePanelData["presets"][number] | null; hasBandPreset: boolean };
  rpc: ExploreRpc;
  createOpen: boolean;
  presetsOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onPresetsOpenChange: (open: boolean) => void;
  onOpenPresets: () => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: ReactNode };
  onChanged: () => Promise<void>;
  renderOnboarding: (props: ExploreOnboardingProps) => ReactNode;
  renderPresetManager: (props: ExplorePresetManagerProps) => ReactNode;
};

export function ExplorePanelDialogs(props: Props) {
  return (
    <>
      {props.renderOnboarding({
        storageKey: STORAGE_KEYS.onboardExplore,
        title: "Choose your exploration agent preset",
        intro: "Explorations run on the explore band preset — set it once here, or pin a different preset per card in Manage.",
        onOpenPresets: props.onOpenPresets,
        active: props.active,
      })}
      <CreateExploreDialog
        open={props.createOpen}
        onOpenChange={props.onCreateOpenChange}
        activeProjectId={props.projectId}
        stages={props.data.stages}
        explorePreset={props.preset.preset}
        hasBandPreset={props.preset.hasBandPreset}
        bucketGallery={props.bucketGallery}
        onOpenPresets={props.onOpenPresets}
      />
      {props.renderPresetManager({
        open: props.presetsOpen,
        onOpenChange: props.onPresetsOpenChange,
        rpc: props.rpc,
        presets: props.data.presets,
        onChanged: props.onChanged,
      })}
    </>
  );
}
