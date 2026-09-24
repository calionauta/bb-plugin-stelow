import type { ReactNode } from "react";
import {
  WorkflowSettings,
  type Appetite,
  type ReviewGates,
} from "../creation/creation-settings";
import { CreateBuildDialog } from "../creation/create-build-dialog";
import { GithubIssuesDialog } from "../github/github-issues-dialog";
import type {
  BuildPanelData,
  BuildPreset,
  BuildProject,
  BuildRpc,
} from "./build-panel-state";

export type PresetManagerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rpc: BuildRpc;
  presets: BuildPreset[];
  onChanged: () => Promise<void>;
};

export type OnboardingProps = {
  storageKey: string;
  title: string;
  intro: string;
  onOpenPresets: () => void;
  active: boolean;
  secondTitle: string;
  secondBody: ReactNode;
};

type Props = {
  active: boolean;
  createOpen: boolean;
  githubOpen: boolean;
  presetsOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onGithubOpenChange: (open: boolean) => void;
  onPresetsOpenChange: (open: boolean) => void;
  onOpenPresets: () => void;
  activeProject: BuildProject | null;
  projectId: string | null;
  data: BuildPanelData;
  analysisWorkerPreset: BuildPreset | null;
  appetite: Appetite;
  reviewGates: ReviewGates;
  onAppetiteChange: (value: Appetite) => void;
  onReviewGatesChange: (value: ReviewGates) => void;
  bucketGallery: { openBucketGallery: () => void; bucketGallery: ReactNode };
  rpc: BuildRpc;
  onChanged: () => Promise<void>;
  renderOnboarding: (props: OnboardingProps) => ReactNode;
  renderPresetManager: (props: PresetManagerProps) => ReactNode;
};

export function BuildPanelDialogs(props: Props) {
  return (
    <>
      {props.renderOnboarding({
        storageKey: "stelow-onboard-build-v1",
        title: "Choose your agent presets",
        intro: "Set the preset each phase runs with. Planning depth and your review gates "
          + "are a separate choice — picked per card in New issue, under the description.",
        onOpenPresets: props.onOpenPresets,
        active: props.active,
        secondTitle: "Defaults for new cards",
        secondBody: (
          <WorkflowSettings
            appetite={props.appetite}
            reviewGates={props.reviewGates}
            onAppetiteChange={props.onAppetiteChange}
            onReviewGatesChange={props.onReviewGatesChange}
            groupNamePrefix="board-default"
          />
        ),
      })}
      <CreateBuildDialog
        open={props.createOpen}
        onOpenChange={props.onCreateOpenChange}
        activeProjectId={props.projectId}
        analysisPreset={props.analysisWorkerPreset}
        appetite={props.appetite}
        reviewGates={props.reviewGates}
        onAppetiteChange={props.onAppetiteChange}
        onReviewGatesChange={props.onReviewGatesChange}
        bucketGallery={props.bucketGallery}
        onOpenPresets={props.onOpenPresets}
      />
      {props.bucketGallery.bucketGallery}
      <GithubIssuesDialog
        open={props.githubOpen}
        onOpenChange={props.onGithubOpenChange}
        projects={props.data.projects}
        activeProjectId={props.projectId}
        activeProjectName={props.activeProject?.name ?? null}
        githubStatus={props.data.githubStatus}
        onChanged={props.onChanged}
      />
      {props.renderPresetManager({
        open: props.presetsOpen,
        onOpenChange: props.onPresetsOpenChange,
        rpc: props.rpc,
        presets: props.data.boardPresets,
        onChanged: props.onChanged,
      })}
    </>
  );
}
