import { useCallback, useEffect, useState } from "react";
import { DECISION_PROVIDERS } from "../../lib/decision-api.mjs";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { DecisionApiConfig, ManagerRpc } from "./decision-api-types";

type DecisionApiDraft = {
  endpoint: string;
  model: string;
  provider: string;
  key: string;
};

function useDecisionApiDraft(rpc: ManagerRpc) {
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("jev");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<DecisionApiConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void rpc.call("getDecisionApiConfig", {}).then((result) => {
      setStatus(result);
      setEndpoint(result.endpoint);
      setModel(result.model);
      setProvider(result.provider);
      setKey("");
      setLoadError(null);
    }).catch(() => {
      setStatus(null);
      setLoadError("Could not load the Decision API settings.");
    });
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

  function setDraft(update: Partial<DecisionApiDraft>) {
    if (update.endpoint !== undefined) setEndpoint(update.endpoint);
    if (update.model !== undefined) setModel(update.model);
    if (update.provider !== undefined) setProvider(update.provider);
    if (update.key !== undefined) setKey(update.key);
  }

  return { endpoint, model, provider, key, status, loadError, reload, setDraft, pickProvider };
}

function useDecisionApiActions(
  rpc: ManagerRpc,
  draft: DecisionApiDraft,
  reload: () => void,
) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(clearKey: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await rpc.call("setDecisionApiConfig", {
        endpoint: draft.endpoint.trim() || null,
        model: draft.model.trim() || null,
        provider: draft.provider,
        apiKey: clearKey ? null : (draft.key ? draft.key : undefined),
      });
      setMessage(result.error ?? "Saved.");
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

  return { message, busy, save, probe };
}

function ProviderSchemaHint({ schema, needsKey }: { schema: string; needsKey: boolean }) {
  if (schema === "labels") {
    return <p className="text-[11px] text-muted-foreground">Labels schema — endpoint only, no key; Choice questions only.</p>;
  }
  if (!needsKey) {
    return <p className="text-[11px] text-muted-foreground">State + questions schema — endpoint + model, no key.</p>;
  }
  return <p className="text-[11px] text-muted-foreground">State + questions schema — endpoint + key + model required.</p>;
}

type DecisionApiDraftView = ReturnType<typeof useDecisionApiDraft>;

function DecisionApiProviderFields({ view }: { view: DecisionApiDraftView }) {
  const providerEntry = DECISION_PROVIDERS.find((entry) => entry.id === view.provider) ?? null;
  const needsKey = providerEntry ? providerEntry.needsKey : true;
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Provider</span>
        <select
          className="cursor-pointer h-9 rounded-md border bg-background px-2 text-sm"
          value={view.provider}
          disabled={view.status?.disabled}
          onChange={(event) => view.pickProvider(event.target.value)}
        >
          <option value="jev">TypeSafe AI&apos;s Jev-compatible</option>
          {DECISION_PROVIDERS.filter((entry) => entry.id !== "jev").map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label}</option>
          ))}
        </select>
      </label>
      {providerEntry ? <ProviderSchemaHint schema={providerEntry.schema} needsKey={needsKey} /> : null}
    </>
  );
}

function DecisionApiConnectionFields({ view }: { view: DecisionApiDraftView }) {
  const providerEntry = DECISION_PROVIDERS.find((entry) => entry.id === view.provider) ?? null;
  const takesModel = providerEntry ? providerEntry.takesModel : true;
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Endpoint</span>
        <Input
          value={view.endpoint}
          disabled={view.status?.disabled}
          onChange={(event) => view.setDraft({ endpoint: event.target.value })}
          placeholder="https://api.typesafe.ai/v1/systemone"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Model</span>
        <Input
          value={view.model}
          disabled={view.status?.disabled || !takesModel}
          onChange={(event) => view.setDraft({ model: event.target.value })}
          placeholder="jev-latest"
        />
      </label>
      {!takesModel ? (
        <p className="text-[11px] text-muted-foreground">This provider answers on its own tier; model does not apply.</p>
      ) : null}
    </>
  );
}

const DECISION_API_KEY_HINTS = [
  "Disabled on this host (STELOW_DECISION_API=0).",
  "No key needed (free tier, rate-limited).",
  "Key from environment (env wins over stored).",
  "Key stored — leave blank to keep it.",
  "No key yet. Routers fall back to built-in rules.",
] as const;

function decisionApiKeyHint(status: DecisionApiConfig | null, needsKey: boolean) {
  if (!status) return "Loading…";
  const hint = status.disabled
    ? 0
    : !needsKey
      ? 1
      : status.keySource === "env"
        ? 2
        : status.hasKey ? 3 : 4;
  return DECISION_API_KEY_HINTS[hint];
}

function DecisionApiKeyField({ view }: { view: DecisionApiDraftView }) {
  const providerEntry = DECISION_PROVIDERS.find((entry) => entry.id === view.provider) ?? null;
  const needsKey = providerEntry ? providerEntry.needsKey : true;
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>API key</span>
      <Input
        type="password"
        value={view.key}
        disabled={view.status?.disabled}
        onChange={(event) => view.setDraft({ key: event.target.value })}
        placeholder={decisionApiKeyHint(view.status, needsKey)}
        autoComplete="off"
      />
    </label>
  );
}

function DecisionApiActions({ view }: {
  view: ReturnType<typeof useDecisionApiActions> & { status: DecisionApiConfig | null };
}) {
  return (
    <div className="flex justify-end gap-2">
      {view.status?.hasKey && view.status.keySource !== "env" && !view.status.disabled ? (
        <Button size="sm" variant="ghost" disabled={view.busy} onClick={() => void view.save(true)}>Clear key</Button>
      ) : null}
      <Button size="sm" variant="outline" disabled={view.busy || view.status?.disabled} onClick={() => void view.probe()}>
        {view.busy ? "Working…" : "Test connection"}
      </Button>
      <Button size="sm" disabled={view.busy || view.status?.disabled} onClick={() => void view.save(false)}>
        {view.busy ? "Working…" : "Save"}
      </Button>
    </div>
  );
}

export function DecisionApiSection({ rpc }: { rpc: ManagerRpc }) {
  const draft = useDecisionApiDraft(rpc);
  const actions = useDecisionApiActions(rpc, draft, draft.reload);
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        One decision endpoint for every router below. Set the provider first — the rest follows its schema.
      </p>
      {draft.status && !draft.status.configured ? (
        <p className="text-xs text-muted-foreground" role="status">
          Showing defaults — nothing saved yet. Save to make these yours.
        </p>
      ) : null}
      {draft.status?.disabled ? (
        <p className="text-xs text-muted-foreground" role="status">
          Decision API is disabled on this host (STELOW_DECISION_API=0). Routers answer with built-in rules.
        </p>
      ) : null}
      <DecisionApiProviderFields view={draft} />
      <DecisionApiConnectionFields view={draft} />
      <DecisionApiKeyField view={draft} />
      {actions.message ?? draft.loadError ? (
        <p className="text-xs text-muted-foreground" role="status">{actions.message ?? draft.loadError}</p>
      ) : null}
      <DecisionApiActions view={{ ...draft, ...actions }} />
    </div>
  );
}
