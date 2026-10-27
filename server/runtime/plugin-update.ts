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

/**
 * The checker's mutable state, held in one object because three functions read
 * it and the disposed flag has to be visible to all of them.
 *
 * A hot reload disposes the plugin while a network check is still in flight.
 * That check holds the API handle it was built with, so the next `await` fails
 * with a stale handle and used to be logged as "plugin update check failed" —
 * a report about a check nobody is waiting for anymore, which the host's own
 * drain then counts as an unsettled invocation. Disposed means: do not start,
 * do not write, do not log. Twenty-seven of those warnings in six weeks came
 * from exactly this.
 */
type CheckerState = {
  state: PluginUpdateState;
  release: GithubRelease | null;
  checkedAt: number;
  inflight: Promise<void> | null;
  disposed: boolean;
};

export function createPluginUpdateChecker(deps: PluginUpdateDeps) {
  const holder: CheckerState = {
    state: initialState,
    release: null,
    checkedAt: 0,
    inflight: null,
    disposed: false,
  };
  return {
    refresh: (force = false) => refresh(deps, holder, force),
    getState: () => holder.state,
    getRelease: () => holder.release,
    /** Called from the plugin's dispose hook, which fires on every hot reload. */
    dispose: () => {
      holder.disposed = true;
    },
  };
}

async function refresh(deps: PluginUpdateDeps, holder: CheckerState, force: boolean): Promise<void> {
  if (holder.disposed) return;
  if (!force && holder.state.outcome !== "checking" && deps.now() - holder.checkedAt < 60_000) return;
  if (holder.inflight) return holder.inflight;
  holder.inflight = check(deps, holder);
  try {
    await holder.inflight;
  } finally {
    holder.inflight = null;
  }
}

async function check(deps: PluginUpdateDeps, holder: CheckerState): Promise<void> {
  try {
    const next = await probeVerdict(deps);
    if (holder.disposed) return;
    holder.state = next;
    if (holder.state.outcome === "update-available") {
      holder.release = null;
      return;
    }
    const latest = await probeRelease(deps);
    if (holder.disposed || !latest) return;
    holder.release = latest;
  } catch (error) {
    if (holder.disposed) return;
    const detail = error instanceof Error ? error.message : String(error);
    holder.state = applyFailedCheck(holder.state, detail);
    deps.bb.log.warn(`plugin update check failed: ${detail}`);
  } finally {
    holder.checkedAt = deps.now();
  }
}

/** The host's own verdict, mapped to this plugin's shape. One await, so the
 * disposed guard at the call site is one line away from the write it protects. */
async function probeVerdict(deps: PluginUpdateDeps): Promise<PluginUpdateState> {
  const entries = await deps.bb.sdk.plugins.checkUpdates({ pluginId: deps.bb.pluginId });
  return { ...mapUpdateEntry(selectOwnEntry(entries, deps.bb.pluginId)), checkedAt: deps.now() };
}

/** The GitHub fallback, for a host that reports no update of its own. */
async function probeRelease(deps: PluginUpdateDeps): Promise<GithubRelease | null> {
  const latest = await (deps.fetchRelease ?? fetchLatestPluginRelease)();
  if (!latest) return null;
  return {
    ...latest,
    checkedAt: deps.now(),
    newer: isNewerRelease(deps.installedVersion, latest.tag),
  };
}
