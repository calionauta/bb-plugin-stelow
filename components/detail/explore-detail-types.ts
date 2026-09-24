import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";

type RpcResults = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;

export type ExploreCard = Extract<RpcResults, { cards: unknown }>["cards"][number];
export type ExploreDetail = Extract<RpcResults, {
  card: unknown;
  comments: unknown;
  pendingQuestions: unknown;
}>;
