import type { ReactNode, RefObject } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { HostFileTarget, WorkspaceFileTarget } from "../artifacts/artifact-inventory";
import type { ArtifactViewerMode } from "../conversation/question-batch";
import type { useDetailComment } from "../conversation/use-detail-comment";
import type { InboxEventItem } from "./inbox-event-banner";
import type { useBuildDetailLifecycle } from "./use-build-detail-lifecycle";
import type { useExecutionRuns } from "./use-execution-runs";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type RpcResult = Awaited<ReturnType<Rpc["call"]>>;

export type BuildCard = Extract<RpcResult, { cards: unknown }>["cards"][number];
export type BuildDetail = Extract<
  RpcResult,
  { card: unknown; comments: unknown; pendingQuestions: unknown }
>;

export type ViewerFile = {
  display: string;
  path: string;
  target: WorkspaceFileTarget | HostFileTarget | null;
  mode?: ArtifactViewerMode;
  // The option whose control opened this file, so the viewer can show that
  // option's section instead of the document's first line.
  optionLabel?: string;
} | null;

type PresetDialogRenderer = (state: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onChanged: () => void;
}) => ReactNode;

export type BuildDetailBodyProps = {
  cardId: string;
  inboxEventId: string | null;
  executionRunId: string | null;
  onClose: () => void;
  onBack?: () => void;
  intentLabels: Record<string, string>;
  onOpenRecoveryAudit: (cardId: string) => void;
  renderPresetDialog: PresetDialogRenderer;
};

type BuildDataState = {
  card: BuildCard | null;
  detail: BuildDetail | null;
  error: string | null;
  inboxEvent: InboxEventItem | null;
  inboxEventRef: RefObject<HTMLElement | null>;
  load: () => Promise<void>;
};

type PresentationState = {
  githubPostOpen: boolean;
  setGithubPostOpen: (open: boolean) => void;
  githubDraftOpen: boolean;
  setGithubDraftOpen: (open: boolean) => void;
  publicationDirty: boolean;
  setPublicationDirty: (dirty: boolean) => void;
  publicationBranch: string | null;
  setPublicationBranch: (branch: string | null) => void;
  presetDialogOpen: boolean;
  setPresetDialogOpen: (open: boolean) => void;
  viewerFile: ViewerFile;
  setViewerFile: (file: ViewerFile) => void;
  artifactsOpen: boolean;
  setArtifactsOpen: (open: boolean) => void;
  mapOpen: boolean;
  setMapOpen: (open: boolean) => void;
  artifactsRef: RefObject<HTMLDivElement | null>;
  showArtifacts: () => void;
};

type AdvanceState = {
  advancing: string | null;
  pendingAdvance: string | null;
  setPendingAdvance: (stage: string | null) => void;
  advance: (stage: string) => Promise<void>;
};

export type BuildDetailView = BuildDataState & PresentationState & AdvanceState & {
  lifecycle: ReturnType<typeof useBuildDetailLifecycle>;
  comments: ReturnType<typeof useDetailComment>;
  execution: ReturnType<typeof useExecutionRuns>;
  focusRunId: string | null;
  onOpenRecoveryAudit: BuildDetailBodyProps["onOpenRecoveryAudit"];
  intentLabels: BuildDetailBodyProps["intentLabels"];
  renderPresetDialog: BuildDetailBodyProps["renderPresetDialog"];
};
