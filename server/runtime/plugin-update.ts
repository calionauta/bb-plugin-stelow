import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { applyFailedCheck, mapUpdateEntry, selectOwnEntry } from "../../lib/plugin-update.mjs";
import type { PluginUpdateVerdict } from "../../lib/plugin-update.mjs";
import { fetchLatestPluginRelease, isNewerRelease } from "../../lib/github-release.mjs";

export type PluginUpdateState = PluginUpdateVerdict;
export type GithubRelease = { tag: string; url: string; checkedAt: number; newer: boolean };

type PluginUpdateDeps = {
  bb: BbPluginApi;
  installedVersion: string;
  now: () => number;
  fetchRelease?: typeof fetchLatestPluginRelease;
};

const initialState: PluginUpdateState = {
  outcome: "checking",
  installed: null,
  installedDisplay: null,
  candidate: null,
  candidateDisplay: null,
  detail: null,
  checkedAt: null,
};

export function createPluginUpdateChecker(deps: PluginUpdateDeps) {
  let state = initialState;
  let release: GithubRelease | null = null;
  let checkedAt = 0;
  let inflight: Promise<void> | null = null;

  async function refresh(force = false): Promise<void> {
    if (!force && state.outcome !== "checking" && deps.now() - checkedAt < 60_000) return;
    if (inflight) return inflight;
    inflight = check();
    try {
      await inflight;
    } finally {
      inflight = null;
    }
  }

  async function check(): Promise<void> {
    try {
      const entries = await deps.bb.sdk.plugins.checkUpdates({ pluginId: deps.bb.pluginId });
      state = { ...mapUpdateEntry(selectOwnEntry(entries, deps.bb.pluginId)), checkedAt: deps.now() };
      if (state.outcome === "update-available") {
        release = null;
        return;
      }
      const latest = await (deps.fetchRelease ?? fetchLatestPluginRelease)();
      if (latest) {
        release = { ...latest, checkedAt: deps.now(), newer: isNewerRelease(deps.installedVersion, latest.tag) };
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      state = applyFailedCheck(state, detail);
      deps.bb.log.warn(`plugin update check failed: ${detail}`);
    } finally {
      checkedAt = deps.now();
    }
  }

  return {
    refresh,
    getState: () => state,
    getRelease: () => release,
  };
}
