import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { Dispatch, SetStateAction } from "react";
import type { rpcContract } from "../../server";

/**
 * The types and window presets the flow surfaces share.
 *
 * Split out when `flow-strip.tsx` crossed the repository's file budget after the detail
 * moved into a drawer. The seam is real rather than a line-count dodge: the strip owns the
 * SUMMARY (a status line on the board) and `flow-drawer-details.tsx` owns the DETAIL (the
 * lists and tabs in the panel), and both need the same shapes to talk about one result.
 */

export type FlowWindow = "all" | "30d" | "90d";
export type FlowTab = "timing" | "attention";

export const FLOW_WINDOWS: Array<{ id: FlowWindow; label: string; days: number | null }> = [
  { id: "all", label: "All time", days: null },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
];

export type FlowRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
export type FlowResult = Awaited<ReturnType<FlowRpc["call"]>>;
export type FlowMetrics = Extract<
  FlowResult,
  { items: unknown; summary: unknown; attention: unknown; coverage: unknown }
>;
export type FlowKind = FlowMetrics["items"][number]["kind"];
export type FlowRow = FlowMetrics["items"][number];
export type FlowAttention = FlowMetrics["attention"][number];

export type FlowViewState = {
  tab: FlowTab;
  setTab: Dispatch<SetStateAction<FlowTab>>;
  window: FlowWindow;
  setWindow: Dispatch<SetStateAction<FlowWindow>>;
};
