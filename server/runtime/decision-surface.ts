/**
 * The decision API and the adapters that reach it.
 *
 * Seeding a build's intent, vetting an auto-continue, and bumping inbox
 * severity all route through one decision client. The adapters exist so a
 * consumer depends on a named verb instead of the whole client, and so the
 * client is constructed in dependency order rather than through forward
 * references from the surfaces that need it first.
 */
import { createDecisionApi } from "../decision-api.js";

export type DecisionSurfaceDeps = Parameters<typeof createDecisionApi>[0];

export function createDecisionSurface(deps: DecisionSurfaceDeps) {
  const api = createDecisionApi(deps);
  return {
    handlers: api.handlers,
    /** Seed a build's intent through the router instead of guessing locally. */
    seedBuildIntent: (promptText: string, projectId: string | null) =>
      api.seedBuildIntent(promptText, projectId),
    /** Whether a silent stop is worth resuming the worker for. */
    vetAutoContinue: (stateText: string | null) =>
      api.vetAutoContinue(stateText),
    maybeBumpSeverity: () => api.maybeBumpSeverity(),
    reviewPolicy: () => api.reviewPolicy(),
    routeConfig: (
      point: Parameters<typeof api.routeConfig>[0],
      config: Parameters<typeof api.routeConfig>[1],
    ) => api.routeConfig(point, config),
  };
}

export type DecisionSurface = ReturnType<typeof createDecisionSurface>;
