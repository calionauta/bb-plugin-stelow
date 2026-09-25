import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { WORKFLOW_SKILLS } from "../../lib/workflow-skills-sync.mjs";
import type { rpcContract } from "../rpc-contract.js";
import type { WorkerCard } from "../workers.js";
import { createCardStore } from "../cards.js";
import { createInboxServer } from "../inbox.js";
import { createPresetServer } from "../presets.js";
import { createScopeProgressSync } from "../scopes.js";
import { createCliDispatch, type CliRunContext, type CliResult } from "./cli-dispatch.js";
import { stelowCliCommands } from "./cli-registry.js";
import { startReconciler, type Scheduler } from "./reconciler.js";
import {
  reconcileLiveCardsOnStartup,
  registerThreadLifecycle,
} from "./thread-lifecycle.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type RpcHandlers = {
  [Name in keyof typeof rpcContract]: (
    input: z.output<(typeof rpcContract)[Name]["input"]>,
  ) => z.output<(typeof rpcContract)[Name]["output"]> | Promise<
    z.output<(typeof rpcContract)[Name]["output"]>
  >;
};

export const CARD_ERRORS = {
  cardNotFound: "Card not found.",
  presetNotFound: "Preset not found.",
} as const;

type CoreDependencyOptions = {
  bb: BbPluginApi;
  db: Db;
  now: () => number;
  randomId: (prefix: string) => string;
};

export function createCoreDependencies(options: CoreDependencyOptions) {
  const cardStore = createCardStore(options.bb, options.db);
  const presetServer = createPresetServer({
    db: options.db,
    bb: options.bb,
    now: options.now,
    errors: CARD_ERRORS,
    getCard: cardStore.getCard,
  });
  const inbox = createInboxServer({
    db: options.db,
    now: options.now,
    randomId: options.randomId,
    publish: (event, payload) => options.bb.realtime.publish(event, payload),
    listProjects: () => options.bb.sdk.projects.list(),
  });
  return { cardStore, presetServer, inbox };
}

type LifecycleDependencies = {
  bb: BbPluginApi;
  db: Db;
  syncThreadState: (cardId: string) => Promise<void>;
  applyFailed: (cardId: string, threadId: string, error: string | null) => Promise<void>;
  executionReconcile: { reconcile: () => Promise<void> };
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (
    card: WorkerCard,
  ) => Promise<{ path: string; hostId: string | null } | null>;
  maybeBumpSeverity: () => Promise<void>;
  notifyClaimWaiters: (workspacePath: string, files: string[]) => Promise<void>;
  disposeWorkers: () => void;
  scheduler?: Scheduler;
};

export function registerRuntimeLifecycle(deps: LifecycleDependencies): void {
  const scheduler = deps.scheduler ?? { setInterval, clearInterval };
  registerThreadLifecycle(deps.bb, deps);
  reconcileLiveCardsOnStartup(deps.db, deps.syncThreadState);
  void deps.executionReconcile.reconcile();
  const executionTimer = scheduler.setInterval(() => {
    if ((deps.db as unknown as { open?: boolean }).open) {
      void deps.executionReconcile.reconcile();
    }
  }, 45_000);
  const reconciler = startReconciler({
    db: deps.db,
    syncThreadState: deps.syncThreadState,
    scopeProgress: createScopeProgressSync({
      getCard: deps.getCard,
      cardWorkspace: deps.cardWorkspace,
      publish: (cardId) => deps.bb.realtime.publish("card-state", { cardId }),
    }),
    maybeBumpSeverity: deps.maybeBumpSeverity,
    notifyClaimWaiters: deps.notifyClaimWaiters,
    now: Date.now,
    onError: (phase, error) => deps.bb.log.warn(
      `Stelow reconciliation ${phase} failed: ${error instanceof Error ? error.message : String(error)}`,
    ),
    scheduler,
  });
  deps.bb.onDispose(() => {
    scheduler.clearInterval(executionTimer);
    reconciler.dispose();
    deps.disposeWorkers();
  });
}

export function registerWorkerSkills(bb: BbPluginApi): void {
  bb.agents.configure((context) => ({
    tools: [],
    skills: context.thread.title?.startsWith("Stelow: ")
      ? [...WORKFLOW_SKILLS]
      : [],
  }));
}

export function registerAutomationSchedule(
  bb: BbPluginApi,
  runAutomationRules: () => Promise<void>,
): void {
  bb.background.schedule(
    "stelow-automation-rules",
    "*/5 * * * *",
    runAutomationRules,
  );
}

export function registerRpcHandlers(
  bb: BbPluginApi,
  contract: typeof rpcContract,
  handlers: RpcHandlers,
): void {
  bb.rpc.register(contract, handlers, { experimental_discoverable: true });
}

export function registerStelowCli(
  bb: BbPluginApi,
  run: (argv: string[], context: CliRunContext) => Promise<CliResult>,
): void {
  const dispatch = createCliDispatch({ run });
  bb.cli.register({
    name: "stelow",
    summary: "Inspect and interact with Stelow workflows",
    commands: stelowCliCommands,
    run: dispatch,
  });
}

export function registerPreviewDisposal(
  bb: BbPluginApi,
  disposePreview: () => Promise<void> | void,
): void {
  bb.onDispose(disposePreview);
}
