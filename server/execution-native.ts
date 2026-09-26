import { createAdapter } from "./execution-native-catalog.js";
import { createNativeLauncher } from "./execution-native-launch.js";
import { createNativeStartPreparer } from "./execution-native-prepare.js";
import { createNativeRouter } from "./execution-native-route.js";
import type { AdapterRun, NativeDeps } from "./execution-native-types.js";

/**
 * The native layer is a composition root. The four rules it wires — the
 * vocabulary and adapter, the preparation, the routing, the launch — each live
 * in their own module and each take only the dependencies they read, so a
 * refusal rule can be read without the route that produced it and a test can
 * call one rule with a double instead of standing up the layer.
 */
export function createExecutionNative(deps: NativeDeps) {
  function adapterFor(run: AdapterRun) {
    return createAdapter(
      {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        threadId: run.originThreadId,
      },
      run.sourceText,
      run.argsText,
    );
  }

  const preparer = createNativeStartPreparer({
    bb: deps.bb,
    randomId: deps.randomId,
    cardWorkspace: deps.cardWorkspace,
    stateDir: deps.stateDir,
  });
  const router = createNativeRouter({ db: deps.db, logComment: deps.logComment });
  const launcher = createNativeLauncher({
    db: deps.db,
    bb: deps.bb,
    adapterFor,
    prepareStart: preparer.prepareStart,
  });

  return {
    adapterFor,
    resolveStageExecutionRoute: router.resolveStageExecutionRoute,
    recordCoordinatorSequentialRoute: router.recordCoordinatorSequentialRoute,
    startNativeStageForCard: launcher.startNativeStageForCard,
  };
}

export type ExecutionNative = ReturnType<typeof createExecutionNative>;
export type { CardRoute as ExecutionRouteInfo } from "./execution-native-types.js";
