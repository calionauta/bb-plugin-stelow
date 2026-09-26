/**
 * Decision routing configuration: the one shared endpoint, provider, model,
 * and key, plus the on-demand probe that proves the route works.
 *
 * Reads disclose key presence and source only — the raw key never leaves the
 * host. Writes keep absent fields (preserve) apart from explicit nulls
 * (clear), and every refusal names the fix.
 */
import {
  DECISION_PROVIDERS,
  buildProbeCall,
  defaultEndpointFor,
  defaultModelFor,
  evaluateDecisionCall,
  isDecisionApiDisabled,
  isDecisionApiEndpointValid,
  normalizeDecisionApiModel,
  normalizeDecisionProvider,
  providerRequiresKey,
  resolveDecisionApiKey,
} from "../lib/decision-api.mjs";
import type { ConfigSave, DecisionStore } from "./decision-store.js";

interface ConfigInput {
  endpoint?: string | null;
  apiKey?: string | null;
  model?: string | null;
  provider?: string | null;
}

type ResolvedConfig =
  | { ok: true; next: ConfigSave }
  | { ok: false; error: string };

export interface DecisionConfigDeps {
  store: DecisionStore;
  now: () => number;
}

/** The stored row plus its normalized provider, the pair every read needs. */
function readConfig(store: DecisionStore) {
  const row = store.configRow();
  return { row, provider: normalizeDecisionProvider(row?.provider ?? "jev") };
}

/**
 * Absent input keeps the stored value, explicit null clears it. The
 * refusals run in order — provider, endpoint, model — so the first thing a
 * caller got wrong is the thing it is told about.
 */
function resolveConfig(store: DecisionStore, input: ConfigInput): ResolvedConfig {
  const { row } = readConfig(store);
  const nextProvider =
    input.provider === undefined
      ? normalizeDecisionProvider(row?.provider ?? "jev")
      : normalizeDecisionProvider(input.provider, "");
  if (!nextProvider)
    return {
      ok: false,
      error: `Unknown provider "${input.provider}". Available: ${DECISION_PROVIDERS.map((entry) => entry.id).join(", ")}.`,
    };
  const nextEndpoint =
    input.endpoint === undefined
      ? (row?.endpoint ?? defaultEndpointFor(nextProvider))
      : (input.endpoint ?? defaultEndpointFor(nextProvider));
  if (!isDecisionApiEndpointValid(nextEndpoint))
    return {
      ok: false,
      error:
        "Endpoint must be an http(s) URL (e.g. https://api.typesafe.ai/v1/systemone).",
    };
  const nextModel =
    input.model === undefined
      ? (row?.model ?? defaultModelFor(nextProvider))
      : normalizeDecisionApiModel(input.model, defaultModelFor(nextProvider));
  if (!nextModel)
    return { ok: false, error: "Model must name a version (e.g. jev-latest)." };
  const nextKey =
    input.apiKey === undefined ? (row?.api_key ?? "") : (input.apiKey ?? "");
  return {
    ok: true,
    next: {
      endpoint: nextEndpoint.trim(),
      apiKey: nextKey,
      model: nextModel,
      provider: nextProvider,
    },
  };
}

function getDecisionApiConfig(store: DecisionStore) {
  const { row, provider } = readConfig(store);
  const { key, source } = resolveDecisionApiKey({
    storedKey: row?.api_key ?? null,
    env: process.env,
  });
  return {
    endpoint: row?.endpoint ?? defaultEndpointFor(provider),
    model: normalizeDecisionApiModel(row?.model, defaultModelFor(provider)),
    hasKey: key !== null,
    keySource: source,
    keyRequired: providerRequiresKey(provider),
    disabled: isDecisionApiDisabled(process.env),
    provider,
    configured: row !== undefined,
  };
}

function setDecisionApiConfig(ctx: DecisionConfigDeps, input: ConfigInput) {
  const resolved = resolveConfig(ctx.store, input);
  if (!resolved.ok) return Promise.resolve({ ok: false, error: resolved.error });
  ctx.store.saveConfig(resolved.next, ctx.now);
  return Promise.resolve({ ok: true, error: null });
}

async function testDecisionApi(store: DecisionStore) {
  if (isDecisionApiDisabled(process.env))
    return {
      ok: false,
      latencyMs: null,
      model: null,
      error: "Decision API is disabled on this host (STELOW_DECISION_API=0).",
    };
  const { row, provider } = readConfig(store);
  const { key } = resolveDecisionApiKey({
    storedKey: row?.api_key ?? null,
    env: process.env,
  });
  if (!key && providerRequiresKey(provider))
    return {
      ok: false,
      latencyMs: null,
      model: null,
      error:
        "No key: set one in Decision API settings or export DECISION_API_KEY.",
    };
  const probe = buildProbeCall(provider);
  const result = await evaluateDecisionCall({
    provider,
    endpoint: row?.endpoint ?? defaultEndpointFor(provider),
    apiKey: key ?? "",
    model: normalizeDecisionApiModel(row?.model, defaultModelFor(provider)),
    state: probe.state,
    questions: probe.questions,
  });
  return result.ok
    ? {
        ok: true,
        latencyMs: result.latencyMs ?? null,
        model: result.model ?? null,
        error: null,
      }
    : {
        ok: false,
        latencyMs: null,
        model: null,
        error: result.error ?? "the Decision API call failed",
      };
}

export function decisionConfigHandlers(ctx: DecisionConfigDeps) {
  return {
    async getDecisionApiConfig() {
      return getDecisionApiConfig(ctx.store);
    },
    async setDecisionApiConfig(input: ConfigInput) {
      return setDecisionApiConfig(ctx, input);
    },
    async testDecisionApi() {
      return testDecisionApi(ctx.store);
    },
  };
}

export type DecisionConfigHandlers = ReturnType<typeof decisionConfigHandlers>;
