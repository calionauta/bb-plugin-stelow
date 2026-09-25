/**
 * The plugin's composition root.
 *
 * This file is a table of contents, not an implementation. It builds the
 * runtime core — the seams every surface shares — and then assembles the five
 * wiring layers in the only order that works: the gates a card must clear, the
 * execution layer that runs its worker, the card surfaces that act on it, the
 * host surfaces that reach outside the card model, and finally the two
 * registries that publish everything to BB.
 *
 * The layers are wired here rather than inside one another so their dependency
 * is visible: gates depend on the core, execution depends on the gates, cards
 * depend on the execution layer, and the host depends on the cards. Nothing
 * reaches back up.
 *
 * Every line below is wiring. There is no behavior here — not a constant, not
 * a fallback, not a shape.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { createRuntimeCore } from "./runtime/runtime-core.js";
import { createGateSurfaces } from "./runtime/wiring/gate-surfaces.js";
import {
  createExecutionSurfaces,
  registerExecutionLifecycle,
} from "./runtime/wiring/execution-surfaces.js";
import { createCardSurfaces } from "./runtime/wiring/card-surfaces.js";
import { createHostSurfaces } from "./runtime/wiring/host-surfaces.js";
import { registerStelowRpc } from "./runtime/wiring/rpc-surfaces.js";
import { registerStelowCommand } from "./runtime/wiring/cli-surfaces.js";
import { deferred } from "./runtime/wiring/deferred.js";
import type { GithubAutomation } from "./github-issues.js";

export default async function plugin(bb: BbPluginApi) {
  const core = createRuntimeCore(bb);
  const gates = createGateSurfaces(core);
  const execution = createExecutionSurfaces({ core, gates });
  // The host layer builds the issue automation, and the board's status column
  // reads it — so it is not built yet when the card layer is wired. The seam
  // names that order: the card layer gets a reader, the host layer a binder.
  const github = deferred<GithubAutomation>();
  const cards = createCardSurfaces({ core, execution, githubAutomation: github.read });
  registerExecutionLifecycle(core, execution);
  const host = createHostSurfaces({ core, cards, github: github.bind });
  registerStelowRpc({ bb, core, gates, execution, cards, host });
  registerStelowCommand({ bb, core, gates, execution, cards });
}
