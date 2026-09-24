import { useCallback, useEffect, useState } from "react";
import type { DecisionRouterPoint, ManagerRpc, RouterPresetOption } from "./decision-api-types";
import { DecisionRouterRow } from "./decision-router-row";

function useRouterState(rpc: ManagerRpc) {
  const [points, setPoints] = useState<DecisionRouterPoint[]>([]);
  const [presets, setPresets] = useState<RouterPresetOption[]>([]);
  const [keyMissing, setKeyMissing] = useState(false);

  const reload = useCallback(() => {
    void rpc.call("listDecisionPoints", {}).then((result) => setPoints(result.points)).catch(() => setPoints([]));
    void rpc.call("listPresets", {}).then((result) => {
      setPresets(result.presets.map((preset) => ({ id: preset.id, name: preset.name })));
    }).catch(() => setPresets([]));
    void rpc.call("getDecisionApiConfig", {}).then((result) => {
      setKeyMissing(result.keyRequired && !result.hasKey);
    }).catch(() => setKeyMissing(false));
  }, [rpc]);

  useEffect(() => { reload(); }, [reload]);
  return { points, presets, keyMissing, reload };
}

export function DecisionRoutersSection({ rpc }: { rpc: ManagerRpc }) {
  const { points, presets, keyMissing, reload } = useRouterState(rpc);
  const refresh = useCallback(async () => { reload(); }, [reload]);
  const keylessApi = keyMissing && points.some((point) => point.mode === "api");

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Each router picks how one judgment runs. Built-in rules run inside existing workers and host code — no extra calls, no keys.
        {" "}Decision API needs the section above. Anything unconfigured answers with built-in rules.
      </p>
      {keylessApi ? (
        <p className="text-xs text-muted-foreground" role="status">
          Decision API has no key — api routers answer with built-in rules until one is set.
        </p>
      ) : null}
      {points.map((point) => (
        <DecisionRouterRow
          key={point.id}
          rpc={rpc}
          point={point}
          presets={presets}
          refresh={refresh}
        />
      ))}
    </div>
  );
}
