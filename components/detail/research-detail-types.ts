import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";

type RpcResults = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;

export type ResearchCard = Extract<RpcResults, { cards: unknown }>["cards"][number];
export type ResearchDetail = Extract<RpcResults, {
  card: unknown;
  comments: unknown;
  pendingQuestions: unknown;
}>;

export type ViewerFile = {
  display: string;
  path: string;
  target: import("../artifacts/artifact-inventory").HostFileTarget | import("../artifacts/artifact-inventory").WorkspaceFileTarget | null;
  mode?: import("../conversation/question-batch").ArtifactViewerMode;
};
