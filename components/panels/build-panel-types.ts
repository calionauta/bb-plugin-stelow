import type { Appetite, ReviewGates } from "../creation/creation-settings";
import type { BoardView } from "../panel/panel-state-hooks";
import type {
  BuildCard,
  BuildPanelData,
  BuildProject,
  BuildRpc,
} from "./build-panel-state";

export type BuildPanelState = {
  rpc: BuildRpc;
  data: BuildPanelData;
  projects: BuildProject[];
  cards: BuildCard[];
  loading: boolean;
  isInitialLoad: boolean;
  load: () => Promise<void>;
  grouped: Record<string, BuildCard[]>;
  projectIds: string[];
  stages: string[];
  intents: string[];
  statuses: string[];
  activities: string[];
  attention: boolean;
  stageOptions: readonly string[];
  appetite: Appetite;
  reviewGates: ReviewGates;
  setAppetite: (value: Appetite) => void;
  setReviewGates: (value: ReviewGates) => void;
  viewMode: BoardView;
  setViewMode: (view: BoardView) => void;
  collapsedColumns: Record<string, boolean>;
  collapsedListGroups: Record<string, boolean>;
  githubAuthMissing: boolean;
  toggleProject: (value: string) => void;
  toggleStage: (value: string) => void;
  toggleIntent: (value: string) => void;
  toggleStatus: (value: string) => void;
  toggleActivity: (value: string) => void;
  toggleColumn: (column: string) => void;
  toggleListGroup: (column: string) => void;
  reset: () => void;
  setAttention: (value: boolean) => void;
};
