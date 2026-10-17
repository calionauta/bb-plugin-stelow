import type { ReactNode } from "react";
import { CreateTrackDialog, EXPLORE_DIALOG_CONFIG, RESEARCH_DIALOG_CONFIG, type TrackDialogConfig } from "../creation/create-track-dialog";
import { STORAGE_KEYS } from "../../lib/panel-storage.mjs";

export type TrackPresetManagerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rpc: any;
  presets: Array<{ id: string } & Record<string, any>>;
  onChanged: () => Promise<void>;
};

export type TrackOnboardingProps = {
  storageKey: string;
  title: string;
  intro: string;
  onOpenPresets: () => void;
  active: boolean;
  showDesignReference?: boolean;
};

export type TrackDialogsConfig = {
  onboardKey: string;
  onboardTitle: string;
  onboardIntro: string;
  showDesignReference?: boolean;
  dialogConfig: TrackDialogConfig;
  catalogProp: "stages" | "strategies";
  presetProp: "explorePreset" | "researchPreset";
};

export const EXPLORE_DIALOGS_CONFIG: TrackDialogsConfig = {
  onboardKey: STORAGE_KEYS.onboardExplore,
  onboardTitle: "Choose your exploration agent preset",
  onboardIntro: "Explorations run on the explore band preset — set it once here, or pin a different preset per card in Manage.",
  showDesignReference: true,
  dialogConfig: EXPLORE_DIALOG_CONFIG,
  catalogProp: "stages",
  presetProp: "explorePreset",
};

export const RESEARCH_DIALOGS_CONFIG: TrackDialogsConfig = {
  onboardKey: STORAGE_KEYS.onboardResearch,
  onboardTitle: "Choose your research agent preset",
  onboardIntro: "Investigations run on the research band preset — set it once here, or pin a different preset per card in Manage.",
  dialogConfig: RESEARCH_DIALOG_CONFIG,
  catalogProp: "strategies",
  presetProp: "researchPreset",
};

type Props = {
  active: boolean;
  projectId: string | null;
  data: { projects?: Array<{ id: string }>; stages?: unknown[]; strategies?: unknown[]; presets: Array<{ id: string } & Record<string, unknown>> };
  preset: { preset: { id: string } & Record<string, unknown> | null; hasBandPreset: boolean };
  rpc: unknown;
  createOpen: boolean;
  presetsOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onPresetsOpenChange: (open: boolean) => void;
  onOpenPresets: () => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: ReactNode };
  onChanged: () => Promise<void>;
  renderOnboarding: (props: any) => ReactNode;
  renderPresetManager: (props: any) => ReactNode;
  config: TrackDialogsConfig;
};

export function TrackPanelDialogs(props: Props) {
  const catalog = (props.config.catalogProp === "stages" ? props.data.stages : props.data.strategies) as
    React.ComponentProps<typeof CreateTrackDialog>["catalog"];
  return (
    <>
      {props.renderOnboarding({
        storageKey: props.config.onboardKey,
        title: props.config.onboardTitle,
        intro: props.config.onboardIntro,
        onOpenPresets: props.onOpenPresets,
        active: props.active,
        ...(props.config.showDesignReference ? { showDesignReference: true } : {}),
      })}
      <CreateTrackDialog
        open={props.createOpen}
        onOpenChange={props.onCreateOpenChange}
        activeProjectId={props.projectId}
        validProjectIds={(props.data.projects ?? []).map((project) => project.id)}
        catalog={catalog ?? []}
        preset={props.preset.preset as React.ComponentProps<typeof CreateTrackDialog>["preset"]}
        hasBandPreset={props.preset.hasBandPreset}
        bucketGallery={props.bucketGallery}
        onOpenPresets={props.onOpenPresets}
        config={props.config.dialogConfig}
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
