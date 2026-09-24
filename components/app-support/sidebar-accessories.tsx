import { useCallback } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { UpdateBadge } from "../settings/update-badge";
import { inboxBadgeCount } from "../../lib/inbox-panel-state.mjs";
import { accessoryTone, activeCardCount } from "../../lib/app-support-state.mjs";
import { usePanelData } from "../panel/panel-state-hooks";
import { usePluginUpdateSignal } from "./plugin-update-signal";
import type { rpcContract } from "../../server";

export interface SidebarAccessoryHandle {
  count: number;
  tone: string;
}

export function SidebarCount({ count, tone, label }: SidebarAccessoryHandle & { label: string }) {
  return (
    <span
      aria-label={label}
      className={`rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums ${tone}`}
    >
      {count}
    </span>
  );
}

function useCountAccessory(
  load: () => Promise<{ count: number }>,
  realtimeChannels: readonly string[],
  activeTone: string,
): SidebarAccessoryHandle {
  const { data } = usePanelData(load, {
    realtimeChannels,
    errorMessage: null,
    initialData: { count: 0 },
    itemCountKey: "count",
    notifyOnError: false,
  });
  return { count: data.count, tone: accessoryTone(data.count, activeTone) };
}

export function useInboxAccessory(): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(async () => {
    const result = await rpc.call("listNotifications", { includeArchived: false });
    return { count: inboxBadgeCount(result.notifications) };
  }, [rpc]);
  return useCountAccessory(
    load,
    ["card-state", "board-changed", "inbox-changed"],
    "bg-primary/15 text-primary",
  );
}

function useTrackCardAccessory(kind: "build" | "research"): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(async () => {
    const result = await rpc.call("listCards", { projectId: null, kind });
    return { count: activeCardCount(result.cards) };
  }, [kind, rpc]);
  return useCountAccessory(
    load,
    ["card-state", "board-changed"],
    "bg-muted text-foreground",
  );
}

export function StelowInboxSidebarAccessory() {
  const { count, tone } = useInboxAccessory();
  const updateAvailable = usePluginUpdateSignal();
  return (
    <span className="inline-flex items-center gap-1">
      <SidebarCount count={count} tone={tone} label={`${count} Stelow Inbox items need attention`} />
      {updateAvailable ? <UpdateBadge label="Stelow plugin update available" /> : null}
    </span>
  );
}

export function useBuildAccessory(): SidebarAccessoryHandle {
  return useTrackCardAccessory("build");
}

export function useResearchAccessory(): SidebarAccessoryHandle {
  return useTrackCardAccessory("research");
}
