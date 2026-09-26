/**
 * Decision routing: how one point reaches a provider.
 *
 * A stored point route overrides the shared settings field by field, so a
 * point can pin a model without redeclaring endpoint and key. Every api-mode
 * judgment resolves its call through this one seam, which is also where the
 * key cascade lives — the three seams below cannot drift into three
 * different notions of "which endpoint does this point use".
 */
import {
  defaultEndpointFor,
  defaultModelFor,
  normalizeDecisionApiModel,
  normalizeDecisionProvider,
  providerRequiresKey,
  resolveDecisionApiKey,
} from "../lib/decision-api.mjs";
import { resolvePointRoute } from "../lib/decision-points.mjs";
import type { ConfigRow, PointRow } from "./decision-store.js";

export interface DecisionRouteDeps {
  configRow: () => ConfigRow | undefined;
}

/** One resolved outbound call, ready for `evaluateDecisionCall`. */
export interface DecisionCallRoute {
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  /** The resolved key before it is coerced to the call's empty-string form. */
  key: string | null;
}

const emptyConfig = {
  provider: null,
  endpoint: "",
  apiKey: "",
  model: "",
};

/**
 * The stored config row is a database shape (`api_key`); the route is the
 * lib's shape (`apiKey`). Mapping it here is what lets a key saved in
 * settings reach a judgment that pinned no key of its own.
 */
function configAsRoute(cfg: ConfigRow | undefined) {
  return cfg
    ? {
        provider: cfg.provider,
        endpoint: cfg.endpoint,
        apiKey: cfg.api_key,
        model: cfg.model,
      }
    : emptyConfig;
}

export function createDecisionRoute(ctx: DecisionRouteDeps) {
  const routeConfig = (
    point: PointRow | undefined,
    cfg: ConfigRow | undefined = ctx.configRow(),
  ) =>
    resolvePointRoute({
      override: point
        ? {
            provider: point.provider,
            endpoint: point.endpoint,
            apiKey: point.api_key,
            model: point.model,
          }
        : null,
      fallback: configAsRoute(cfg),
    });

  /** `usable` is false when the provider needs a key and none resolves. */
  const callRoute = (point: PointRow | undefined): DecisionCallRoute & {
    usable: boolean;
  } => {
    const route = routeConfig(point);
    const provider = normalizeDecisionProvider(route.provider ?? "jev");
    const { key } = resolveDecisionApiKey({
      storedKey: route.apiKey ?? null,
      env: process.env,
    });
    return {
      provider,
      endpoint: route.endpoint ?? defaultEndpointFor(provider),
      apiKey: key ?? "",
      model: normalizeDecisionApiModel(route.model, defaultModelFor(provider)),
      key,
      usable: key !== null || !providerRequiresKey(provider),
    };
  };

  return { routeConfig, callRoute };
}

export type DecisionRoute = ReturnType<typeof createDecisionRoute>;
