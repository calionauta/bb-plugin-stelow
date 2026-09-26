/**
 * Depth contracts for artifacts, and the one import every consumer uses.
 *
 * The data lives in three slices by area — lib/jtbd-contracts.mjs (composite
 * JTBD substeps), lib/strategy-contracts.mjs (research strategy primaries),
 * lib/explore-contracts.mjs (explore stages and Build document shapes) — and
 * this module only re-exports them, so a consumer never has to know which
 * slice an entry came from. The check DSL they are written in is documented
 * and interpreted by lib/artifact-validation.mjs.
 */
export { JTBD_CONTRACTS, contractForSubstep } from "./jtbd-contracts.mjs";
export { STRATEGY_CONTRACTS, contractForStrategy } from "./strategy-contracts.mjs";
export {
  EXPLORE_CONTRACTS,
  contractForExplore,
  contractForBuildArtifact,
} from "./explore-contracts.mjs";
