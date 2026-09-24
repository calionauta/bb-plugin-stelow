import { useEffect, useSyncExternalStore } from "react";
import {
  markPluginUpdateLoaded,
  markPluginUpdateUnloaded,
  pluginUpdateSnapshot,
  setPluginUpdateAvailable,
  subscribePluginUpdate,
} from "../../lib/plugin-update-signal.mjs";
import { updateAvailableFrom } from "../../lib/plugin-update.mjs";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";

export function usePluginUpdateSignal(): boolean {
  const rpc = useRpc<typeof rpcContract>();
  const available = useSyncExternalStore(subscribePluginUpdate, pluginUpdateSnapshot, pluginUpdateSnapshot);
  useEffect(() => {
    if (!markPluginUpdateLoaded()) return;
    void rpc.call("buildInfo", {}).then((info) => {
      setPluginUpdateAvailable(updateAvailableFrom(info));
    }).catch(() => markPluginUpdateUnloaded());
  }, [rpc]);
  return available;
}
