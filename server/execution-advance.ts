import { createCardAdvance } from "./execution-advance-card.js";
import { createCliAdvance } from "./execution-advance-cli.js";
import { createAdvanceDispatcher, createBandRouter } from "./execution-advance-dispatch.js";
import { createAdvancePreflight } from "./execution-advance-preflight.js";
import type { AdvanceDeps } from "./execution-advance-types.js";

/**
 * The advance is a composition root over two rules (preflight, dispatch) and two
 * entry points that drive them (the card action, the CLI). Both entry points
 * call the same two rules, so a fix to either is a fix to both; the wiring lives
 * here because the rules themselves should never need to know which entry point
 * is calling, or which of the two owns the band swap.
 */
export function createExecutionAdvance(deps: AdvanceDeps) {
  const preflight = createAdvancePreflight(deps);
  const dispatcher = createAdvanceDispatcher(deps);
  const services = {
    prepareAdvance: preflight.prepareAdvance,
    dispatchAdvance: dispatcher.dispatchAdvance,
    applyBand: createBandRouter(deps).applyBand,
  };

  return {
    handlers: { advanceCard: createCardAdvance(deps, services).advanceCard },
    cli: createCliAdvance(deps, services).advanceCli,
  };
}

export type ExecutionAdvance = ReturnType<typeof createExecutionAdvance>;
export type { AdvanceDeps } from "./execution-advance-types.js";
