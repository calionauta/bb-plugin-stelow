import type { ReactNode } from "react";
import { CreateResearchDialog } from "../creation/create-research-dialog";
import { STORAGE_KEYS } from "../../lib/panel-storage.mjs";
import type {
  ResearchPanelData,
  ResearchRpc,
} from "./research-panel-state";

export type ResearchPresetManagerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rpc: ResearchRpc;
  presets: ResearchPanelData["presets"];
  onChanged: () => Promise<void>;
};

export type ResearchOnboardingProps = {
  storageKey: string;
  title: string;
  intro: string;
  onOpenPresets: () => void;
  active: boolean;
};

type Props = {
  active: boolean;
  projectId: string | null;
  data: ResearchPanelData;
  preset: { preset: ResearchPanelData["presets"][number] | null; hasBandPreset: boolean };
  rpc: ResearchRpc;
  createOpen: boolean;
  presetsOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onPresetsOpenChange: (open: boolean) => void;
  onOpenPresets: () => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: ReactNode };
  onChanged: () => Promise<void>;
  renderOnboarding: (props: ResearchOnboardingProps) => ReactNode;
  renderPresetManager: (props: ResearchPresetManagerProps) => ReactNode;
};

export function ResearchPanelDialogs(props: Props) {
  return (
    <>
      {props.renderOnboarding({
        storageKey: STORAGE_KEYS.onboardResearch,
        title: "Choose your research agent preset",
        intro: "Investigations run on the research band preset — set it once here, or pin a different preset per card in Manage.",
        onOpenPresets: props.onOpenPresets,
        active: props.active,
      })}
      <CreateResearchDialog
        open={props.createOpen}
        onOpenChange={props.onCreateOpenChange}
        activeProjectId={props.projectId}
        strategies={props.data.strategies}
        researchPreset={props.preset.preset}
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
