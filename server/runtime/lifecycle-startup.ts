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
  void updates.refresh();
  runPluginMigrations(deps.bb, deps.db, deps.now);
  runExecutionMigrations(deps.db);
  return { updates };
}
