import { useCallback, useEffect, useState } from "react";
import { DECISION_PROVIDERS } from "../../lib/decision-api.mjs";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { modeLabel } from "./preset-execution-values.mjs";

type DecisionApiConfig = {
  endpoint: string;
  model: string;
  hasKey: boolean;
  keySource: string | null;
  keyRequired: boolean;
  disabled: boolean;
  provider: string;
  configured: boolean;
};

type DecisionPointRoute = {
  provider: string | null;
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
};

type DecisionRouterPoint = {
  id: string;
  label: string;
  description: string;
  rules: string;
  requires: string | null;
  modes: string[];
  mode: string;
  thresholds: Record<string, number>;
  route: DecisionPointRoute | null;
  presetId: string | null;
};

type RouterPresetOption = { id: string; name: string };
type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export function DecisionApiSection({ rpc }: { rpc: ManagerRpc }) {
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("jev");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<DecisionApiConfig | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => {
    void rpc.call("getDecisionApiConfig", {}).then((result) => {
      setStatus(result);
      setEndpoint(result.endpoint);
      setModel(result.model);
      setProvider(result.provider);
      setKey("");
      setMessage(null);
    }).catch(() => setMessage("Could not load the Decision API settings."));
  }, [rpc]);
  useEffect(() => { reload(); }, [reload]);

  function pickProvider(next: string) {
    setProvider(next);
    const knownDefaults = DECISION_PROVIDERS.map((entry) => entry.defaultEndpoint);
    if (endpoint === "" || knownDefaults.includes(endpoint)) {
      setEndpoint(DECISION_PROVIDERS.find((entry) => entry.id === next)?.defaultEndpoint ?? endpoint);
    }
    if (model === "" || DECISION_PROVIDERS.some((entry) => entry.defaultModel !== "" && entry.defaultModel === model)) {
      setModel(DECISION_PROVIDERS.find((entry) => entry.id === next)?.defaultModel ?? model);
    }
  }

  async function save(clearKey: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("setDecisionApiConfig", {
        endpoint: endpoint.trim() || null,
        model: model.trim() || null,
        provider,
        apiKey: clearKey ? null : (key ? key : undefined),
      });
      setMessage(result.error ?? "Saved.");
      setKey("");
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function probe() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("testDecisionApi", {});
      setMessage(result.ok
        ? `Probe ok · ${result.latencyMs ?? "?"}ms · ${result.model ?? "unknown model"}`
        : (result.error ?? "Probe failed."));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Probe failed.");
    } finally {
      setBusy(false);
    }
  }

  const providerEntry = DECISION_PROVIDERS.find((entry) => entry.id === provider) ?? null;
  const providerNeedsKey = providerEntry ? providerEntry.needsKey : true;
  const providerTakesModel = providerEntry ? providerEntry.takesModel : true;
  const keyHint = !status
    ? "Loading…"
    : status.disabled
      ? "Disabled on this host (STELOW_DECISION_API=0)."
      : !providerNeedsKey
        ? "No key needed (free tier, rate-limited)."
        : status.keySource === "env"
          ? "Key from environment (env wins over stored)."
          : status.hasKey
            ? "Key stored — leave blank to keep it."
            : "No key yet. Routers fall back to built-in rules.";

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        One decision endpoint for every router below. Set the provider first — the rest follows its schema.
      </p>
      {status && !status.configured ? (
        <p className="text-xs text-muted-foreground" role="status">
          Showing defaults — nothing saved yet. Save to make these yours.
        </p>
      ) : null}
      {status?.disabled ? (
        <p className="text-xs text-muted-foreground" role="status">
          Decision API is disabled on this host (STELOW_DECISION_API=0). Routers answer with built-in rules.
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Provider</span>
        <select
          className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm"
          value={provider}
          disabled={status?.disabled}
          onChange={(event) => pickProvider(event.target.value)}
        >
          <option value="jev">TypeSafe AI&apos;s Jev-compatible</option>
          {DECISION_PROVIDERS.filter((entry) => entry.id !== "jev").map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label}</option>
          ))}
        </select>
      </label>
      {providerEntry && providerEntry.schema === "jev" && providerNeedsKey ? (
        <p className="text-[11px] text-muted-foreground">State + questions schema — endpoint + key + model required.</p>
      ) : null}
      {providerEntry && providerEntry.schema === "jev" && !providerNeedsKey ? (
        <p className="text-[11px] text-muted-foreground">State + questions schema — endpoint + model, no key.</p>
      ) : null}
      {providerEntry && providerEntry.schema === "labels" ? (
        <p className="text-[11px] text-muted-foreground">Labels schema — endpoint only, no key; Choice questions only.</p>
      ) : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Endpoint</span>
        <Input
          value={endpoint}
          disabled={status?.disabled}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="https://api.typesafe.ai/v1/systemone"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Model</span>
        <Input value={model} disabled={status?.disabled || !providerTakesModel} onChange={(event) => setModel(event.target.value)} placeholder="jev-latest" />
      </label>
      {!providerTakesModel ? (
        <p className="text-[11px] text-muted-foreground">This provider answers on its own tier; model does not apply.</p>
      ) : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>API key</span>
        <Input
          type="password"
          value={key}
          disabled={status?.disabled}
          onChange={(event) => setKey(event.target.value)}
          placeholder={keyHint}
          autoComplete="off"
        />
      </label>
      {message ? <p className="text-xs text-muted-foreground" role="status">{message}</p> : null}
      <div className="flex justify-end gap-2">
        {status?.hasKey && status.keySource !== "env" && !status.disabled ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(true)}>Clear key</Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={busy || status?.disabled} onClick={() => void probe()}>
          {busy ? "Working…" : "Test connection"}
        </Button>
        <Button size="sm" disabled={busy || status?.disabled} onClick={() => void save(false)}>
          {busy ? "Working…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function DecisionRouterRow({
  rpc,
  point,
  presets,
  refresh,
}: {
  rpc: ManagerRpc;
  point: DecisionRouterPoint;
  presets: RouterPresetOption[];
  refresh: () => Promise<void>;
}) {
  const [modeDraft, setModeDraft] = useState(point.mode);
  const [routeAt, setRouteAt] = useState(String(point.thresholds.routeAt ?? 0.6));
  const [presetId, setPresetId] = useState(point.presetId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  useEffect(() => {
    setModeDraft(point.mode);
    setRouteAt(String(point.thresholds.routeAt ?? 0.6));
    setPresetId(point.presetId ?? "");
  }, [point]);

  function note(text: string, error: boolean) {
    setMessage(text);
    setIsError(error);
  }

  async function save(input: { mode?: string; presetId?: string | null }) {
    setBusy(true);
    note("", false);
    try {
      const result = await rpc.call("setDecisionPoint", {
        point: point.id,
        mode: input.mode ?? point.mode,
        ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
      });
      if (result.error) note(result.error, true);
      else {
        note("Saved.", false);
        await refresh();
      }
    } catch (err) {
      note(err instanceof Error ? err.message : "Save failed.", true);
    } finally {
      setBusy(false);
    }
  }

  async function saveThreshold() {
    setBusy(true);
    note("", false);
    try {
      const result = await rpc.call("setDecisionPoint", {
        point: point.id,
        mode: modeDraft,
        thresholds: { routeAt: Number(routeAt) },
      });
      if (result.error) note(result.error, true);
      else {
        note("Saved.", false);
        await refresh();
      }
    } catch (err) {
      note(err instanceof Error ? err.message : "Save failed.", true);
    } finally {
      setBusy(false);
    }
  }

  const dirty = Number(routeAt) !== (point.thresholds.routeAt ?? 0.6);
  const valid = routeAt.trim() !== "" && Number.isFinite(Number(routeAt)) && Number(routeAt) >= 0 && Number(routeAt) <= 1;
  const modeDirty = modeDraft !== point.mode;

  return (
    <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate" title={point.description}>
          <span className="font-medium">{point.label}</span>
        </span>
        <select
          aria-label={`${point.label} mode`}
          className="cursor-pointer h-11 shrink-0 rounded-md border bg-background px-2 text-sm"
          value={modeDraft}
          disabled={busy}
          onChange={(event) => {
            setModeDraft(event.target.value);
            note("", false);
          }}
        >
          {point.modes.map((mode) => <option key={mode} value={mode}>{modeLabel(mode)}</option>)}
        </select>
        {modeDirty && modeDraft !== "preset" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ mode: modeDraft })}>Save</Button>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">{point.description}</p>
      {point.mode === "rules" && modeDraft === "rules" ? (
        <p className="text-[11px] text-muted-foreground">Built-in rules: {point.rules}</p>
      ) : null}
      {point.requires ? <p className="text-[11px] text-muted-foreground">Needs: {point.requires}</p> : null}
      {modeDraft === "api" || modeDraft === "preset" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <label className="flex flex-1 items-center gap-2">
            <span className="shrink-0">Act at confidence ≥</span>
            <Input type="number" min="0" max="1" step="0.05" className="h-11" value={routeAt} onChange={(event) => setRouteAt(event.target.value)} />
          </label>
          <Button size="sm" variant="outline" disabled={busy || !dirty || !valid} onClick={() => void saveThreshold()}>Save</Button>
        </div>
      ) : null}
      {modeDraft === "preset" ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="text-[11px]">
            Preset judge asks one of your provider presets to answer this judgment in a hidden thread — one thread per judgment, archived right after.
            {" "}Pick this when you trust one of your own models more than the shared endpoint above. Any preset works, including one no workflow stage uses.
            {" "}Each judgment costs a provider turn; failures fall back to built-in rules.
          </p>
          {presets.length === 0 ? (
            <p className="text-[11px]" role="status">No presets yet — create one under Agent Presets, then pick it here.</p>
          ) : null}
          <div className="flex items-center gap-2">
            <select
              aria-label={`${point.label} judge preset`}
              className="cursor-pointer h-11 flex-1 rounded-md border bg-background px-2 text-sm text-foreground"
              value={presetId}
              disabled={busy}
              onChange={(event) => {
                setPresetId(event.target.value);
                note("", false);
              }}
            >
              <option value="">Pick a preset…</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || presetId.trim() === ""}
              onClick={() => void save({ mode: "preset", presetId: presetId.trim() })}
            >
              Save preset
            </Button>
          </div>
          {point.mode === "preset" && point.presetId ? (
            <p className="text-[11px]">Judging on {presets.find((preset) => preset.id === point.presetId)?.name ?? point.presetId}.</p>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="text-[11px] text-destructive" role={isError ? "alert" : "status"}>{message}</p> : null}
    </div>
  );
}

export function DecisionRoutersSection({ rpc }: { rpc: ManagerRpc }) {
  const [points, setPoints] = useState<DecisionRouterPoint[]>([]);
  const [presets, setPresets] = useState<RouterPresetOption[]>([]);
  const [keyMissing, setKeyMissing] = useState(false);
  const reload = useCallback(() => {
    void rpc.call("listDecisionPoints", {}).then((result) => setPoints(result.points)).catch(() => setPoints([]));
    void rpc.call("listPresets", {}).then((result) => {
      setPresets(result.presets.map((preset) => ({ id: preset.id, name: preset.name })));
    }).catch(() => setPresets([]));
    void rpc.call("getDecisionApiConfig", {}).then((result) => setKeyMissing(result.keyRequired && !result.hasKey)).catch(() => setKeyMissing(false));
  }, [rpc]);
  useEffect(() => { reload(); }, [reload]);
  const keylessApi = keyMissing && points.some((point) => point.mode === "api");
  const refresh = useCallback(async () => { reload(); }, [reload]);

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Each router picks how one judgment runs. Built-in rules run inside existing workers and host code — no extra calls, no keys.
        {" "}Decision API needs the section above. Anything unconfigured answers with built-in rules.
      </p>
      {keylessApi ? (
        <p className="text-xs text-muted-foreground" role="status">Decision API has no key — api routers answer with built-in rules until one is set.</p>
      ) : null}
      {points.map((point) => <DecisionRouterRow key={point.id} rpc={rpc} point={point} presets={presets} refresh={refresh} />)}
    </div>
  );
}
