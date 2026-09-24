import { useState, type Dispatch, type SetStateAction } from "react";
import type { rpcContract } from "../../server";
import {
  beginPluginUpdateApply,
  beginPluginUpdateCheck,
  completePluginUpdateApply,
  completePluginUpdateCheck,
  failPluginUpdateApply,
  failPluginUpdateCheck,
  initialPluginUpdateState,
  shortRef,
  timeOutPluginUpdateApply,
  updateAvailableFrom,
  type BuildInfo,
  type PluginUpdateState,
} from "../../lib/plugin-update.mjs";
import { setPluginUpdateAvailable } from "../../lib/plugin-update-signal.mjs";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

const APPLY_SETTLE_MS = 15_000;
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type SetBuildInfo = Dispatch<SetStateAction<BuildInfo | null>>;

function usePluginUpdateRecheck(rpc: Rpc, buildInfo: BuildInfo | null, setBuildInfo: SetBuildInfo) {
  const [state, setState] = useState(initialPluginUpdateState);

  function recheck() {
    if (state.checking) return;
    setState(beginPluginUpdateCheck);
    void rpc.call("checkPluginUpdate", {}).then((result) => {
      const nextBuildInfo = buildInfo ? { ...buildInfo, ...result } : buildInfo;
      setState((previous) => completePluginUpdateCheck(previous, nextBuildInfo, result));
      setBuildInfo(() => nextBuildInfo);
      setPluginUpdateAvailable(updateAvailableFrom(result));
    }).catch((cause) => {
      setState((previous) => failPluginUpdateCheck(previous, cause));
    });
  }

  return { state, recheck, setState };
}

function usePluginUpdateApply(
  state: PluginUpdateState,
  rpc: Rpc,
  setBuildInfo: SetBuildInfo,
  setState: Dispatch<SetStateAction<PluginUpdateState>>,
) {
  function apply() {
    const started = beginPluginUpdateApply(state);
    if (started === state) return;
    setState(started);
    void runApply(started, rpc, setBuildInfo, setState);
  }

  return apply;
}

async function runApply(
  previous: PluginUpdateState,
  rpc: Rpc,
  setBuildInfo: SetBuildInfo,
  setState: Dispatch<SetStateAction<PluginUpdateState>>,
) {
  let settled = false;
  let applied = false;
  const settle = (state: PluginUpdateState) => {
    if (settled) return;
    settled = true;
    setState(() => state);
  };
  const timer = window.setTimeout(() => {
    settle(timeOutPluginUpdateApply(previous));
  }, APPLY_SETTLE_MS);

  try {
    const result = await rpc.call("applyPluginUpdate", {});
    window.clearTimeout(timer);
    applied = result.applied;
    if (result.applied) {
      toast.success(`Plugin updated to ${shortRef(result.to, null) ?? "the latest compatible version"}.`);
    }
    const info = result.applied ? await rpc.call("buildInfo", {}) : null;
    const next = completePluginUpdateApply(previous, result, info);
    if (info) {
      setBuildInfo(() => info);
      setPluginUpdateAvailable(updateAvailableFrom(info));
    }
    settle(next);
  } catch (cause) {
    window.clearTimeout(timer);
    settle(failPluginUpdateApply(previous, cause, applied));
  }
}

export function usePluginUpdateActions(buildInfo: BuildInfo | null, setBuildInfo: SetBuildInfo) {
  const rpc = useRpc<typeof rpcContract>();
  const recheckState = usePluginUpdateRecheck(rpc, buildInfo, setBuildInfo);
  const apply = usePluginUpdateApply(recheckState.state, rpc, setBuildInfo, recheckState.setState);
  return {
    ...recheckState.state,
    recheck: recheckState.recheck,
    setConfirming: (confirming: boolean) => recheckState.setState((previous) => ({ ...previous, confirming })),
    apply,
  };
}
