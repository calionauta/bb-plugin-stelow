import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { runPluginMigrations } from "../core-migrations.js";
import { runExecutionMigrations } from "../execution-contract.js";
import { createPluginUpdateChecker } from "./plugin-update.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type StartupDeps = {
  bb: BbPluginApi;
  db: Db;
  now: () => number;
  installedVersion: string;
};

export function startRuntimeServices(deps: StartupDeps) {
  const updates = createPluginUpdateChecker({
    bb: deps.bb,
    installedVersion: deps.installedVersion,
    now: deps.now,
  });
  deps.bb.background.schedule("stelow-plugin-update-check", "17 6 * * *", () => void updates.refresh(true));
  // The check starts at boot and is cancelled at reload: it holds the API
  // handle, and a fetch that outlives the plugin turns into "stale API handle"
  // plus an unsettled invocation the host has to time out.
  deps.bb.onDispose(() => updates.dispose());
  void updates.refresh();
  runPluginMigrations(deps.bb, deps.db, deps.now);
  runExecutionMigrations(deps.db);
  return { updates };
}
