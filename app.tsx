import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  definePluginApp,
  UrlLink,
  useBbNavigate,
  useRpc,
  type PluginCommandRegistration,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { inboxBadgeCount } from "./lib/inbox-panel-state.mjs";
import { resetOnboarding } from "./lib/preset-onboarding-state.mjs";
import { relativeTime } from "./lib/relative-time.mjs";
import { shortRef, isPathInstall, updateAvailableFrom } from "./lib/plugin-update.mjs";
import {
  BareCardRoute,
  CardDrawerAdapter,
  INTENT_LABEL,
  StelowCardDetail,
} from "./components/detail/card-detail-route";
import { StelowPanel } from "./components/panel/stelow-panel";
import { InboxPanel } from "./components/panels/inbox-panel";
import { BuildPanel } from "./components/panels/build-panel";
import { ResearchPanel } from "./components/panels/research-panel";
import { ExplorePanel } from "./components/panels/explore-panel";
import { rememberStelowReturnFocusCardId } from "./components/panel/stelow-focus.mjs";
import {
  STELOW_PANEL_ID,
  STELOW_PANEL_PATH,
  cardSubPath,
  trackRootSubPath,
  type ParsedStelowRoute,
  type StelowTrack,
} from "./components/panel/stelow-route.mjs";
import { useDebouncedRealtime } from "./components/use-debounced-realtime";
import { PresetOnboardingDialog } from "./components/settings/preset-onboarding";
import { PresetAssignDialog } from "./components/settings/preset-assign-dialog";
import { PresetManagerDialog } from "./components/settings/preset-manager-shell";
import { registerPendingInteraction } from "./components/conversation/question-form";
import { DisclosureChevron } from "./components/disclosure";
import { StelowArtifactDirective } from "./components/messages/stelow-artifact-directive";
import { StelowQualityDirective } from "./components/messages/stelow-quality-directive";
import { OpenStelowAction } from "./components/thread/open-stelow-action";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Intent mapping lives server-side (lib/github-intent.mjs, single source).
// The panel no longer guesses intent; the server derives it from live labels.
// Stages are ordered workflow checkpoints; phases are board-level groups.
// Explore calls its independent, one-off choices techniques instead.
// Lightweight-track columns (Research + Explore share them): a deliberately
// dumb Bucket / Doing / Done flow. Canonical in lib/tracks (shared with the
// server via lib/card-move) — these aliases keep existing call sites stable.
// Statuses reuse the shared enum (pending / in-progress / completed /
// archived) so no migration or guard changes are needed; the mapping lives
// in lib/card-question-state (shared with the server) so a waiting question
// — activity, never status — can never push a Doing card back to the Bucket.
// Every navigation flows through goToTrack / goToCard, so track roots and
// card URLs keep one owner in the panel router feature.
type BbNavigate = ReturnType<typeof useBbNavigate>;
function goToTrack(navigate: BbNavigate, track: StelowTrack): void {
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: trackRootSubPath(track) });
}
function goToCard(navigate: BbNavigate, card: Pick<CardItem, "kind">, cardId: string, eventId?: string | null): void {
  rememberStelowReturnFocusCardId(cardId);
  navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: cardSubPath(card, cardId, eventId) });
}
type BoardResult = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;
type CardsResponse = Extract<BoardResult, { cards: unknown }>;
type CardItem = CardsResponse["cards"][number];

interface SidebarAccessoryHandle {
  count: number;
  tone: string;
}

function SidebarCount({ count, tone, label }: SidebarAccessoryHandle & { label: string }) {
  return (
    <span
      aria-label={label}
      className={`rounded-full px-1.5 py-0.5 text-2xs font-medium tabular-nums ${tone}`}
    >
      {count}
    </span>
  );
}

function useInboxAccessory(): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("listNotifications", { includeArchived: false });
      // Badge = live action needed. It deliberately matches the first Inbox
      // filter, so a visible count never opens to an empty state.
      setCount(inboxBadgeCount(result.notifications));
    } catch {
      /* host will show stale silently */
    }
  }, [rpc]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useDebouncedRealtime(["card-state", "board-changed", "inbox-changed"], () => void reload());
  const tone = count > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground";
  return { count, tone };
}

// The update affordance shared by every surface — sidebar accessory, About
// tab badge, About header, and the update status box — so the amber "↑" reads
// as the same signal everywhere it appears. labeled={null} renders it
// decorative for places where surrounding text already names the state.
function UpdateBadge({ label = "Plugin update available" }: { label?: string | null }) {
  return (
    <span
      {...(label === null ? { "aria-hidden": true } : { "aria-label": label, title: label })}
      className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-2xs font-medium text-amber-700 dark:text-amber-300"
    >
      ↑
    </span>
  );
}

function StelowInboxSidebarAccessory() {
  const { count, tone } = useInboxAccessory();
  const updateAvailable = usePluginUpdateSignal();
  return <span className="inline-flex items-center gap-1"><SidebarCount count={count} tone={tone} label={`${count} Stelow Inbox items need attention`} />{updateAvailable ? <UpdateBadge label="Stelow plugin update available" /> : null}</span>;
}

// The update signal every surface shares: sidebar accessory, About tab
// badge, About header, and the status box. BB pushes no update events, so a
// module-level store (filled by the first buildInfo read, refreshed by a
// forced check and by the post-apply read) keeps them in lockstep — the
// per-component mount poll this replaced lit only the surface that checked,
// so a "Check update" inside About never reached the sidebar or the tab.
let pluginUpdateAvailable = false;
let pluginUpdateLoaded = false;
const pluginUpdateListeners = new Set<() => void>();
function setPluginUpdateAvailable(next: boolean): void {
  if (pluginUpdateAvailable === next) return;
  pluginUpdateAvailable = next;
  for (const listener of pluginUpdateListeners) listener();
}
function subscribePluginUpdate(listener: () => void): () => void {
  pluginUpdateListeners.add(listener);
  return () => { pluginUpdateListeners.delete(listener); };
}
function pluginUpdateSnapshot(): boolean { return pluginUpdateAvailable; }

function usePluginUpdateSignal(): boolean {
  const rpc = useRpc<typeof rpcContract>();
  const available = useSyncExternalStore(subscribePluginUpdate, pluginUpdateSnapshot, pluginUpdateSnapshot);
  useEffect(() => {
    if (pluginUpdateLoaded) return;
    pluginUpdateLoaded = true;
    void rpc.call("buildInfo", {}).then((info) => {
      setPluginUpdateAvailable(updateAvailableFrom(info));
    }).catch(() => { pluginUpdateLoaded = false; });
  }, [rpc]);
  return available;
}

function useBuildAccessory(): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("listCards", { projectId: null, kind: "build" });
      setCount(result.cards.filter((card) => card.status !== "completed" && card.status !== "archived").length);
    } catch {
      /* Keep the last known count while the host reconnects. */
    }
  }, [rpc]);
  useEffect(() => { void reload(); }, [reload]);
  useDebouncedRealtime(["card-state", "board-changed"], () => void reload());
  const tone = count > 0 ? "bg-muted text-foreground" : "bg-muted text-muted-foreground";
  return { count, tone };
}

function useResearchAccessory(): SidebarAccessoryHandle {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const reload = useCallback(async () => {
    try {
      const result = await rpc.call("listCards", { projectId: null, kind: "research" });
      setCount(result.cards.filter((card) => card.status !== "completed" && card.status !== "archived").length);
    } catch {
      /* Keep the last known count while the host reconnects. */
    }
  }, [rpc]);
  useEffect(() => { void reload(); }, [reload]);
  useDebouncedRealtime(["card-state", "board-changed"], () => void reload());
  const tone = count > 0 ? "bg-muted text-foreground" : "bg-muted text-muted-foreground";
  return { count, tone };
}

// Optional host binaries the workflow knows how to use. Presence is probed
// live on the host (toolStatus); install commands are the canonical
// one-liners from the upstream README's External Dependencies section.
// Everything here is opt-in and fail-soft — the plugin never installs
// unless you press the button (explicit consent), and every capability
// keeps working with its built-in fallback until then.
const HOST_TOOLS: Array<{ id: "ast-grep" | "cymbal" | "ripwire" | "sem"; name: string; repo: string; plain: string; tech: string; install: string }> = [
  { id: "ast-grep", name: "ast-grep", repo: "https://github.com/ast-grep/ast-grep", plain: "Find code patterns and rename across files without touching text inside strings — when refactoring.", tech: "Structural AST search with safe rewrite; used for refactors that change signatures.", install: "npm install -g @ast-grep/cli" },
  { id: "cymbal", name: "cymbal", repo: "https://github.com/1broseidon/cymbal", plain: "See who calls each function and what breaks if you change it — before touching code.", tech: "Symbol graph (refs, impact, trace); used in Tech Preview, Feature Recon and Alignment Check.", install: "brew install 1broseidon/tap/cymbal" },
  { id: "ripwire", name: "ripwire", repo: "https://github.com/redhat-et/ripwire", plain: "First read of an unfamiliar codebase: what matters, where to enter, what to test.", tech: "Token-budgeted symbol map (symbols, callers, blast radius).", install: "RIPWIRE_REPO=redhat-et/ripwire bash -c \"$(curl -fsSL https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)\"" },
  { id: "sem", name: "sem", repo: "https://github.com/Ataraxy-Labs/sem", plain: "Tell which functions and types changed — not just which lines — including renames.", tech: "Entity-level diff via tree-sitter; powers the Diff summary and agent audits.", install: "curl -fsSL https://raw.githubusercontent.com/Ataraxy-Labs/sem/main/install.sh | sh" },
];

// Resolved on demand through npx — no host install, nothing to probe, no
// buttons. Listed so the full dependency surface is visible in one place;
// each entry names who consumes it and under which consent. No commands
// shown: you never run anything here, workers resolve it automatically.
const NPX_TOOLS: Array<{ name: string; repo?: string; plain: string; tech: string }> = [
  {
    name: "npx skills",
    repo: "https://github.com/vercel-labs/skills",
    plain: "The skills hub workers use to fetch playbooks and stack-matched skills on demand.",
    tech: "Ships with Node.js; invoked per use, never installed globally by the plugin.",
  },
  {
    name: "ctx7",
    repo: "https://github.com/upstash/context7",
    plain: "Current, version-specific library docs while writing code — never for choosing the stack.",
    tech: "Auto-installs on first npx invocation; guided OAuth setup (terminal) only raises limits.",
  },
  {
    name: "last30days",
    repo: "https://github.com/mvanhorn/last30days-skill",
    plain: "Social recency signal for market research — complementary source only.",
    tech: "Agent skill, not a binary; workers add it per use, only with your confirmation.",
  },
  {
    name: "agent-reach",
    repo: "https://github.com/Panniantong/agent-reach",
    plain: "Fetch router for platform evidence (incl. Bilibili/Xiaohongshu) — fetch only, never synthesis.",
    tech: "Agent skill + local CLIs; workers add it per use, only with your confirmation. "
      + "Login channels need your browser session or cookies — use a secondary account, never the primary.",
  },
  {
    name: "thermo-nuclear",
    repo: "https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review",
    plain: "Optional ultra-strict final code review, gated by appetite and risk.",
    tech: "Agent skill from the cursor/plugins hub package; documented manual checks apply when absent.",
  },
];

function HostToolsSection({ tools, onInstall, installingId, errors }: {
  tools: Array<{ id: string; present: boolean; version: string | null }> | null;
  onInstall: (id: "ast-grep" | "cymbal" | "ripwire" | "sem") => void;
  installingId: string | null;
  errors: Record<string, string>;
}) {
  const byId = new Map((tools ?? []).map((tool) => [tool.id, tool]));
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">Optional tools</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        Recommended by Stelow, honored here. Workers use these tools when present; without one, the same step still works with the built-in fallback — just with less depth. Install anytime; effects apply on next use.{" "}
        <UrlLink href="https://github.com/calionauta/stelow#external-dependencies" className="underline underline-offset-4 hover:text-foreground">Learn more ↗</UrlLink>
      </p>
      {!tools ? <p className="text-xs text-muted-foreground">Checking host tools…</p> : (
      <div className="space-y-2">
        {HOST_TOOLS.map((meta) => {
          const hit = byId.get(meta.id);
          const present = hit?.present === true;
          const busy = installingId === meta.id;
          const error = errors[meta.id];
          return (
            <div key={meta.id} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <span aria-hidden className={present ? "text-emerald-500" : "text-muted-foreground/50"}>{present ? "●" : "○"}</span>
                <span className="font-mono text-xs font-semibold text-foreground">{meta.name}</span>
                <UrlLink href={meta.repo} title={`${meta.name} repository`} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:border-primary/50 hover:text-foreground"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden /></UrlLink>
                <span className="text-[11px] text-muted-foreground">{present ? (hit?.version ?? "installed") : "not installed"}</span>
                {!present ? (
                  <span className="ml-auto">
                    <Button size="sm" variant="outline" disabled={busy || installingId !== null} onClick={() => onInstall(meta.id)} title={`Install ${meta.name} now`}>
                      {busy ? "Installing…" : "Install"}
                    </Button>
                  </span>
                ) : null}
                {present ? (
                  <span className="ml-auto">
                    <Button size="sm" variant="ghost" disabled={busy || installingId !== null} onClick={() => onInstall(meta.id)} title={`Reinstall ${meta.name} at its latest release`}>
                      {busy ? "Updating…" : "Update"}
                    </Button>
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.plain}</p>
              <p className="mt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/80">{meta.tech}</p>
              {!present && !busy ? <pre className="mt-1.5 overflow-x-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{meta.install}</pre> : null}
              {busy ? <p className="mt-1.5 text-[11px] text-muted-foreground">Installing — can take a couple minutes. The row flips to ● on success.</p> : null}
              {error ? (
                <div className="mt-1.5 space-y-1">
                  <p className="text-[11px] text-destructive">Install failed: {error.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 220) ?? "unknown error"}</p>
                  <details className="group">
                    <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"><DisclosureChevron />Install log</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{error}</pre>
                  </details>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      )}
      <h3 className="pt-2 text-sm font-semibold text-foreground">Ready via npx — no install needed</h3>
      <p className="text-xs leading-5 text-muted-foreground">You never run anything below — workers resolve these automatically when a step needs them. Listed so every dependency Stelow touches is visible.</p>
      <div className="space-y-2">
        {NPX_TOOLS.map((meta) => (
          <div key={meta.name} className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-foreground">{meta.name}</span>
              {meta.repo ? (
                <UrlLink href={meta.repo} title={`${meta.name} repository`} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:border-primary/50 hover:text-foreground"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden /></UrlLink>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.plain}</p>
            <p className="mt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/80">{meta.tech}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

type PluginUpdateInfo = {
  outcome: "checking" | "update-available" | "current" | "incompatible" | "pinned" | "unavailable";
  installed: string | null;
  installedDisplay: string | null;
  candidate: string | null;
  candidateDisplay: string | null;
  detail: string | null;
  checkedAt: number | null;
};
type GithubReleaseInfo = { tag: string; url: string; checkedAt: number; newer: boolean } | null;

// Update status for the About panel: one tone-coded box directly under the
// plugin title, so the verdict, the apply action, and the freshness check
// read together next to the version they describe. role="status" announces
// state changes to assistive tech; the leading mark is decorative
// (aria-hidden) because the title text names the state.
function PluginUpdateStatus({ version, update, github, confirming, updating, checking, onCheck, onConfirm, onCancel, onApply }: {
  version: string;
  update: PluginUpdateInfo;
  github: GithubReleaseInfo;
  confirming: boolean;
  updating: boolean;
  checking: boolean;
  onCheck: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const tone = update.outcome === "current" ? "text-emerald-500"
    : update.outcome === "update-available" ? "text-amber-500"
    : "text-muted-foreground/60";
  const title = update.outcome === "update-available"
    ? (confirming
      ? `Update from ${shortRef(update.installed, update.installedDisplay) ?? "the installed version"} to ${shortRef(update.candidate, update.candidateDisplay) ?? "the latest version"}?`
      : `Update available — ${shortRef(update.candidate, update.candidateDisplay) ?? "a new version"}`)
    : update.outcome === "current"
      ? "Up to date"
      : update.outcome === "checking"
        ? "Checking BB for a compatible plugin update…"
        : update.outcome === "pinned" || update.outcome === "incompatible"
          ? "Not updated through BB"
          : "Update check unavailable";
  const unmanaged = update.outcome === "pinned" || update.outcome === "incompatible" || update.outcome === "unavailable";
  // Only path installs take the manual path (checkout pull + rebuild +
  // reload); every other source is BB-managed, so manual instructions
  // must never reach users who have no checkout.
  const pathInstall = isPathInstall(update.installedDisplay);
  return (
    <div role="status" className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {update.outcome === "update-available" ? <UpdateBadge label={null} /> : <span aria-hidden className={tone}>●</span>}{title}
      </p>
      {update.outcome === "update-available" ? (
        confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={updating} onClick={onApply}>{updating ? "Updating…" : "Confirm update"}</Button>
            <Button size="sm" variant="ghost" disabled={updating} onClick={onCancel}>Cancel</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onConfirm} title="Apply the update and reload Stelow">Update plugin…</Button>
          </div>
        )
      ) : null}
      {update.outcome === "update-available" ? <p>Stelow reloads afterwards.</p> : null}
      {update.outcome === "update-available" && update.detail ? <p>{update.detail} — showing the last known verdict; Check update retries.</p> : null}
      {unmanaged && update.detail ? <p>{update.detail}</p> : null}
      {unmanaged && !update.detail && pathInstall ? <p>BB reports this install as not updatable through BB itself — local checkouts update with git pull, rebuild, and reload. “Check update” refreshes BB’s verdict and the GitHub release lookup together.</p> : null}
      {unmanaged && !update.detail && !pathInstall ? <p>BB can’t apply an update to this install automatically right now. “Check update” re-checks; new releases appear here once BB can apply them.</p> : null}
      {unmanaged && pathInstall && github && !github.newer && version !== "dev" && version.replace(/^v/, "") === github.tag.replace(/^v/, "") ? (
        <p>Matches {github.tag} on GitHub — this checkout is current.</p>
      ) : null}
      {unmanaged && github?.newer ? (
        <p className="text-amber-700 dark:text-amber-300">
          <UrlLink href={github.url} className="underline underline-offset-4 hover:text-foreground">{github.tag} is published on GitHub ↗</UrlLink>
          {" "}{pathInstall ? "— pull the checkout, rebuild, and reload to run it." : "— it will be offered here once BB can apply it."}
        </p>
      ) : null}
      {update.outcome === "checking" ? null : (
        <p>
          {update.checkedAt ? `Last checked ${relativeTime(update.checkedAt)} · ` : null}
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground disabled:cursor-default disabled:opacity-60"
          >
            {checking ? "Checking…" : "Check update"}
          </button>
        </p>
      )}
    </div>
  );
}

function AboutPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [buildInfo, setBuildInfo] = useState<{ version: string; builtAt: string | null; stelowVersion: string | null; skills: string[]; pluginUpdate: PluginUpdateInfo; githubRelease: GithubReleaseInfo } | null>(null);
  const [aboutLogo, setAboutLogo] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [hostTools, setHostTools] = useState<Array<{ id: string; present: boolean; version: string | null }> | null>(null);
  const [installingToolId, setInstallingToolId] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  function installHostTool(id: "ast-grep" | "cymbal" | "ripwire" | "sem") {
    setInstallingToolId(id);
    setInstallErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    void rpc.call("installTool", { id }).then((result) => {
      if (result.ok) {
        void rpc.call("toolStatus", {}).then((status) => setHostTools(status.tools)).catch(() => undefined);
      } else {
        setInstallErrors((prev) => ({ ...prev, [id]: result.log || "Install failed." }));
      }
    }).catch((error) => {
      setInstallErrors((prev) => ({ ...prev, [id]: error instanceof Error ? error.message : "Install failed." }));
    }).finally(() => setInstallingToolId(null));
  }
  // Two-step reset: first click arms the confirm, second clears all four
  // onboarding keys so each track shows its setup dialogs again on visit.
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmPluginUpdate, setConfirmPluginUpdate] = useState(false);
  const [updatingPlugin, setUpdatingPlugin] = useState(false);
  const [checkingPluginUpdate, setCheckingPluginUpdate] = useState(false);
  const [pluginUpdateError, setPluginUpdateError] = useState<string | null>(null);
  const [pluginUpdateNotice, setPluginUpdateNotice] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("buildInfo", {}).then((result) => { if (cancelled) return; setBuildInfo(result); setPluginUpdateAvailable(updateAvailableFrom(result)); }).catch(() => undefined);
    void rpc.call("aboutLogo", {}).then((result) => { if (!cancelled && result.dataUri) setAboutLogo(result.dataUri); }).catch(() => undefined);
    void rpc.call("toolStatus", {}).then((result) => { if (!cancelled) setHostTools(result.tools); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc]);
  function applyPluginUpdate() {
    setUpdatingPlugin(true); setPluginUpdateError(null); setPluginUpdateNotice(null);
    // Applying swaps the server bundle and reloads the plugin. That reload can
    // sever the RPC channel mid-call, leaving the promise pending forever (no
    // resolve, no reject) — so timebox the quiet phase and, if nothing settles,
    // say the reload is happening instead of spinning on "Updating…" with no
    // verdict. A clean apply that never settles only does so because the
    // reload cut the channel, so the reloading message is the honest one.
    const APPLY_SETTLE_MS = 15_000;
    let settled = false;
    const settle = () => { if (settled) return; settled = true; setUpdatingPlugin(false); setConfirmPluginUpdate(false); };
    const timer = window.setTimeout(() => {
      setPluginUpdateNotice("Update applied — Stelow is reloading; the new version appears shortly.");
      settle(); // the caller's component may have unmounted with the reload; a late settle is a no-op
    }, APPLY_SETTLE_MS);
    let applied = false;
    void rpc.call("applyPluginUpdate", {}).then((result) => {
      window.clearTimeout(timer);
      applied = result.applied;
      if (!result.applied) {
        setPluginUpdateError(result.detail ?? "BB did not apply an update.");
        settle();
        return;
      }
      toast.success(`Plugin updated to ${shortRef(result.to, null) ?? "the latest compatible version"}.`);
      return rpc.call("buildInfo", {}).then((info) => {
        if (info) { setBuildInfo(info); setPluginUpdateAvailable(updateAvailableFrom(info)); }
        else setPluginUpdateNotice("Update applied — Stelow is reloading; the new version appears shortly.");
        settle();
      });
    }).catch((error) => {
      window.clearTimeout(timer);
      if (applied) setPluginUpdateNotice("Update applied — Stelow is reloading; the new version appears shortly.");
      else setPluginUpdateError(error instanceof Error ? error.message : "Plugin update failed.");
      settle();
    });
  }
  function recheckPluginUpdate() {
    setCheckingPluginUpdate(true); setPluginUpdateError(null); setPluginUpdateNotice(null); setConfirmPluginUpdate(false);
    void rpc.call("checkPluginUpdate", {}).then((update) => {
      setBuildInfo((prev) => prev ? { ...prev, pluginUpdate: update.pluginUpdate, githubRelease: update.githubRelease } : prev);
      // A forced check is the freshest verdict there is: publish it to every
      // surface at once instead of letting one component own the news.
      setPluginUpdateAvailable(updateAvailableFrom(update));
    }).catch((error) => {
      setPluginUpdateError(error instanceof Error ? error.message : "Update check failed.");
    }).finally(() => setCheckingPluginUpdate(false));
  }
  return (
    <>
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-[1500px] space-y-4">
          <header>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight">About</h1>
              {buildInfo && updateAvailableFrom(buildInfo) ? <UpdateBadge /> : null}
            </div>
          </header>
          <div className="grid max-w-2xl gap-5">
            <section className="space-y-2">
              {aboutLogo ? (
                <div className="flex justify-center py-1">
                  <img src={aboutLogo} alt="Stelow — Your Product Team" className="w-56 max-w-full object-contain sm:w-64" />
                </div>
              ) : null}
              <h2 className="text-base font-semibold text-foreground">
                Stelow {buildInfo?.stelowVersion ? <span className="text-[11px] font-normal text-muted-foreground">v{buildInfo.stelowVersion}</span> : null}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">Stelow helps humans and AI agents operate as a cross-functional product team, not just coding assistants, through a structured product workflow.</p>
              <div>
                <UrlLink href="https://github.com/calionauta/stelow" className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-card px-3 text-xs font-medium shadow-sm hover:border-primary/50"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden />Stelow repo <span aria-hidden="true">↗</span></UrlLink>
              </div>
            </section>
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">
                bb-plugin-stelow {buildInfo ? <span className="text-[11px] font-normal text-muted-foreground" title={buildInfo.builtAt ? `Built ${new Date(buildInfo.builtAt).toLocaleString()}` : "Running build"}>v{buildInfo.version}</span> : null}
              </h2>
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-sm font-semibold text-foreground">Status</h3>
                {buildInfo ? (
                <div className="mt-2">
                <PluginUpdateStatus
                  version={buildInfo.version}
                  update={buildInfo.pluginUpdate}
                  github={buildInfo.githubRelease}
                  confirming={confirmPluginUpdate}
                  updating={updatingPlugin}
                  checking={checkingPluginUpdate}
                  onCheck={recheckPluginUpdate}
                  onConfirm={() => setConfirmPluginUpdate(true)}
                  onCancel={() => setConfirmPluginUpdate(false)}
                  onApply={applyPluginUpdate}
                />
                {pluginUpdateError ? <p className="mt-2 text-xs text-destructive" role="alert">{pluginUpdateError}</p> : null}
                {pluginUpdateNotice ? <p className="mt-2 text-xs text-primary" role="status">{pluginUpdateNotice}</p> : null}
                </div>
                ) : (
                <p className="mt-1 text-xs text-muted-foreground">Checking status…</p>
                )}
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-sm font-semibold text-foreground">What this plugin gives you</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">This plugin hosts Stelow inside bb: Build, Research, and Explore boards, a quiet inbox that only interrupts when the agent needs you, and a worker CLI with deterministic artifact checks.</p>
              {buildInfo ? (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <span aria-hidden className="text-emerald-500">●</span>
                    <button type="button" onClick={() => setSkillsOpen(true)} className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground" title={`Pinned to Stelow ${buildInfo.stelowVersion ?? "at this plugin release"} — click to see which skills shipped`}>
                      {buildInfo.skills.length} skills · pinned to Stelow {buildInfo.stelowVersion ?? "this release"}
                    </button>
                  </p>
                  <p>Skills refresh with plugin updates — this pin names the methodology this build carries.</p>
                </div>
              ) : null}
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Working as a team? bb is single-user — <UrlLink href="https://calionauta.github.io/stelow/#teams" className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground">see the experimental team playbook</UrlLink>: one bb per teammate, GitHub as the team room.</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <h3 className="text-sm font-semibold text-foreground">Resources & maintenance</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                <UrlLink href="https://github.com/calionauta/bb-plugin-stelow" className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-card px-3 text-xs font-medium shadow-sm hover:border-primary/50"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden />Plugin repo <span aria-hidden="true">↗</span></UrlLink>
                {confirmReset ? (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        resetOnboarding(window.localStorage);
                        setConfirmReset(false);
                        toast.success("Onboarding reset — Build, Research, and Explore open their setup dialogs again on visit.");
                      }}
                      title="Clear onboarding state so every track shows its setup dialog again"
                    >
                      Confirm reset
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)} title="Show the first-visit setup dialogs again">Reset onboarding</Button>
                )}
                </div>
              </div>
              </section>
              <HostToolsSection tools={hostTools} onInstall={installHostTool} installingId={installingToolId} errors={installErrors} />
            </div>
        </div>
      </div>
    </div>
    <Dialog open={skillsOpen} onOpenChange={setSkillsOpen}>
      <DialogContent className="max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Vendored Stelow skills</DialogTitle>
          <DialogDescription>
            Pinned to Stelow {buildInfo?.stelowVersion ?? "this plugin release"}. Workers load these exact files from the plugin — no network or silent updates at card time.
          </DialogDescription>
        </DialogHeader>
        {(["stelow-workflow-", "stelow-product-"] as const).map((prefix) => {
          const group = (buildInfo?.skills ?? []).filter((name) => name.startsWith(prefix));
          if (!group.length) return null;
          return (
            <div key={prefix} className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {prefix === "stelow-workflow-" ? "Workflow" : "Product playbooks"} ({group.length})
              </h3>
              <ul className="mt-1 space-y-0.5">
                {group.map((name) => (
                  <li key={name} className="font-mono text-xs text-foreground">{name.replace(prefix, "")}</li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="mt-4">
          <UrlLink href="https://github.com/calionauta/stelow/tree/main/skills" className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-card px-3 text-xs font-medium shadow-sm hover:border-primary/50"><Icon name="Github" className="h-3.5 w-3.5" aria-hidden />Upstream skills ↗</UrlLink>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function renderTrackPanel(tab: StelowTrack, active: boolean) {
  if (tab === "inbox") return <InboxPanel />;
  if (tab === "build") {
    return (
      <BuildPanel
        active={active}
        renderOnboarding={(props) => <PresetOnboardingDialog {...props} />}
        renderPresetManager={(props) => <PresetManagerDialog {...props} />}
      />
    );
  }
  if (tab === "research") {
    return (
      <ResearchPanel
        active={active}
        renderOnboarding={(props) => <PresetOnboardingDialog {...props} />}
        renderPresetManager={(props) => <PresetManagerDialog {...props} />}
      />
    );
  }
  if (tab === "explore") {
    return (
      <ExplorePanel
        active={active}
        renderOnboarding={(props) => <PresetOnboardingDialog {...props} />}
        renderPresetManager={(props) => <PresetManagerDialog {...props} />}
      />
    );
  }
  return <AboutPanel />;
}

function renderCardRoute(
  route: ParsedStelowRoute,
  navigate: BbNavigate,
  onOpenRecoveryAudit: (cardId: string) => void,
  renderPresetDialog: (cardId: string, props: { open: boolean; onOpenChange: (next: boolean) => void; onChanged: () => void }) => React.ReactNode,
) {
  const shared = {
    navigate,
    intentLabels: INTENT_LABEL,
    onOpenRecoveryAudit,
    renderPresetDialog,
  };
  if (route.kind === "bare-card") {
    return <BareCardRoute cardId={route.cardId} eventId={route.eventId} {...shared} />;
  }
  if (route.kind === "card") {
    return <StelowCardDetail cardId={route.cardId} eventId={route.eventId} backTrack={route.origin} {...shared} />;
  }
  return null;
}

type PresetDialogRendererProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onChanged: () => void;
};

function StelowPanelRoute({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const inbox = useInboxAccessory();
  const build = useBuildAccessory();
  const research = useResearchAccessory();
  const aboutAlert = usePluginUpdateSignal();
  const renderPresetDialog = (cardId: string, { open, onOpenChange, onChanged }: PresetDialogRendererProps) => (
    <PresetAssignDialog open={open} onOpenChange={onOpenChange} cardId={cardId} onChanged={onChanged} />
  );
  return (
    <StelowPanel
      subPath={subPath}
      counts={{ inbox: inbox.count, build: build.count, research: research.count, explore: 0, about: 0 }}
      aboutAlert={aboutAlert}
      updateBadge={<UpdateBadge />}
      onSelectTrack={(track) => goToTrack(navigate, track)}
      renderCard={(route) => renderCardRoute(
        route,
        navigate,
        (cardId) => goToCard(navigate, { kind: "build" }, cardId),
        renderPresetDialog,
      )}
      renderTrack={renderTrackPanel}
    />
  );
}

// Timeline of the 17 workflow stages, grouped by phase (band). Each stage is a
// chip: passed / current / upcoming. Clicking an allowed target advances or
// regresses ONE stage — the timeline is the position context AND the advance
// control, so the user always sees where the card is and what it can move to.

// Palette commands open the extracted drawer with a threadId (no card context
// at the palette); its adapter resolves that thread to the owning card.
function StelowCardDrawer(props: PluginThreadPanelProps) {
  const navigate = useBbNavigate();
  const renderPresetDialog = (cardId: string, { open, onOpenChange, onChanged }: PresetDialogRendererProps) => (
    <PresetAssignDialog open={open} onOpenChange={onOpenChange} cardId={cardId} onChanged={onChanged} />
  );
  return (
    <CardDrawerAdapter
      {...props}
      intentLabels={INTENT_LABEL}
      onOpenRecoveryAudit={(cardId) => goToCard(navigate, { kind: "build" }, cardId)}
      renderPresetDialog={renderPresetDialog}
    />
  );
}

function PillsyStyles() {
  if (typeof document === "undefined") return null;
  if (document.getElementById("stelow-style")) return null;
  const style = document.createElement("style");
  style.id = "stelow-style";
  style.textContent = [
    "@keyframes stelow-card-alive { 0%, 100% { border-color: hsl(220 90% 60% / 0.45); box-shadow: 0 0 0 0 hsl(220 90% 60% / 0); } 50% { border-color: hsl(220 90% 60% / 0.75); box-shadow: 0 0 0 2px hsl(220 90% 60% / 0.12); } }",
    "@keyframes stelow-card-attention { 0%, 100% { border-color: hsl(38 92% 50% / 0.50); box-shadow: 0 0 0 0 hsl(38 92% 50% / 0); } 50% { border-color: hsl(38 92% 50% / 0.88); box-shadow: 0 0 0 3px hsl(38 92% 50% / 0.16); } }",
    ".stelow-live-surface.stelow-border-running, details.stelow-border-running { border-color: hsl(220 90% 60% / 0.5) !important; animation: stelow-card-alive 3.2s ease-in-out infinite; }",
    ".stelow-live-surface.stelow-border-attention { border-color: hsl(38 92% 50% / 0.75) !important; animation: stelow-card-attention 2.4s ease-in-out infinite; }",
    ".stelow-detail-surface.stelow-border-running, .stelow-detail-surface.stelow-border-attention { box-shadow: inset 0 0 0 1px currentColor; }",
    "@media (prefers-reduced-motion: reduce) { .stelow-live-surface.stelow-border-running, .stelow-live-surface.stelow-border-attention, details.stelow-border-running { animation: none; } .stelow-live-surface.stelow-border-running { border-color: hsl(220 90% 60% / 0.7) !important; } .stelow-live-surface.stelow-border-attention { border-color: hsl(38 92% 50% / 0.85) !important; } }",
    ".stelow-pill-working { background: hsl(220 90% 60% / 0.12); animation: stelow-breathe 1.8s ease-in-out infinite; color: hsl(220 90% 40%); }",
    "@keyframes stelow-breathe { 0% { opacity: 0.55; } 50% { opacity: 1; } 100% { opacity: 0.55; } }",
    "@keyframes stelow-hill-draw { to { stroke-dashoffset: 0; } }",
    "@keyframes stelow-hill-in { from { opacity: 0; scale: 0.4; } to { opacity: 1; scale: 1; } }",
    "@keyframes stelow-hill-attn-pulse { 0%, 100% { box-shadow: 0 0 0 0 hsl(38 92% 50% / 0); } 50% { box-shadow: 0 0 0 5px hsl(38 92% 50% / 0.18); } }",
    "@keyframes stelow-hill-panel-in { from { opacity: 0; translate: 0 4px; } to { opacity: 1; translate: 0 0; } }",
    ".stelow-hill-draw { stroke-dasharray: 100; stroke-dashoffset: 100; animation: stelow-hill-draw 1.1s ease-out forwards; }",
    ".stelow-hill-dot { animation: stelow-hill-in 0.45s ease backwards; transition: scale 0.16s ease; }",
    ".stelow-hill-dot:hover { scale: 1.6; }",
    ".stelow-hill-attn { animation: stelow-hill-in 0.45s ease backwards, stelow-hill-attn-pulse 2.4s ease-in-out 0.6s infinite; }",
    ".stelow-hill-panel { animation: stelow-hill-panel-in 0.18s ease-out; }",
    "@media (prefers-reduced-motion: reduce) { .stelow-hill-draw, .stelow-hill-dot, .stelow-hill-attn, .stelow-hill-panel { animation: none; } .stelow-hill-draw { stroke-dashoffset: 0; } }",
    ".stelow-activity-pill { display: inline-flex; align-items: center; gap: 0.25rem; border-radius: 9999px; padding: 0.125rem 0.5rem; font-size: 11px; line-height: 18px; font-weight: 500; border-width: 1px; border-style: dashed; }",
    ".stelow-activity-onhold { border-color: hsl(240 5% 55% / 0.55); color: hsl(240 3% 45%); background: transparent; }",
    ".stelow-activity-waiting { border-color: hsl(38 92% 45% / 0.7); color: hsl(38 80% 28%); background: hsl(38 92% 45% / 0.10); animation: stelow-breathe 1.8s ease-in-out infinite; }",
    ".stelow-activity-error { border-color: hsl(0 84% 55% / 0.7); color: hsl(0 70% 40%); background: hsl(0 84% 55% / 0.08); }",
    ".stelow-activity-working { border-color: hsl(220 90% 60% / 0.6); color: hsl(220 60% 40%); background: hsl(220 90% 60% / 0.08); animation: stelow-breathe 1.8s ease-in-out infinite; }",
    ".dark .stelow-activity-onhold { border-color: hsl(240 5% 60% / 0.5); color: hsl(240 10% 70%); }",
    ".dark .stelow-activity-waiting { border-color: hsl(38 92% 55% / 0.65); color: hsl(40 80% 75%); }",
    ".dark .stelow-activity-error { border-color: hsl(0 84% 60% / 0.65); color: hsl(0 80% 80%); }",
    ".dark .stelow-activity-working { border-color: hsl(220 90% 65% / 0.6); color: hsl(220 70% 80%); }",
    // The open card's current stage breathes with the same effect as the
    // board card's working chip (stelow-breathe) — one pulse language for
    // "this is where work is happening", reused, never reinvented.
    ".stelow-stage-pulse { animation: stelow-breathe 1.8s ease-in-out infinite; }",
    "@media (prefers-reduced-motion: reduce) { .stelow-stage-pulse { animation: none; } }",
  ].join("\n");
  document.head.appendChild(style);
  return null;
}

export default definePluginApp((app) => {
  // One sidebar row for the whole plugin. All tracks live on as subPath
  // routes (see STELOW_TRACKS).
  // The badge counts what matters: unresolved inbox action items.
  // Sidebar icon truth: the host renders package.json#bb.branding.icon,
  // which WINS over this panel icon (plugin?.icon ?? panel icon in ZO).
  // Both names must be in BB's allowlist (An base map + Cn extended chunk:
  // jn = [...Object.keys(An), ...Cn]); anything else falls back to Zap.
  // Star (extended chunk) is the stellar mark. (Tab icons are unaffected —
  // they render from the plugin's own HugeIcons set.)
  app.slots.navPanel({
    id: STELOW_PANEL_ID,
    title: "Stelow • Product Hub",
    icon: "Star",
    path: STELOW_PANEL_PATH,
    component: (props) => { PillsyStyles(); return <StelowPanelRoute subPath={props.subPath} />; },
    experimental_sidebarAccessory: StelowInboxSidebarAccessory,
  });
  registerPendingInteraction(app);
  app.slots.threadPanelAction({ id: "stelow-card-detail", title: "Stelow card", icon: "Columns2", component: StelowCardDrawer });
  app.slots.experimental_threadHeaderAction({ id: "open-stelow", title: "Open Stelow", component: OpenStelowAction });

  // Quick-palette command (BB 0.43 `app.commands.register`): from any worker
  // thread, open its Stelow card. The palette context carries no card id, so
  // the drawer resolves threadId itself. Hosts predating `app.commands`
  // keep the deprecated `commandPaletteAction` alias with the same shape.
  const openCardCommand: PluginCommandRegistration = {
    id: "open-card-for-thread",
    title: "Stelow: open card for this thread",
    isAvailable: (context) => context.threadId !== null,
    run: (context) => {
      if (context.threadId) context.openPanel({ actionId: "stelow-card-detail", params: { threadId: context.threadId } });
    },
  };
  const appCommands = (app as unknown as { commands?: { register: (registration: PluginCommandRegistration) => void } }).commands;
  if (appCommands?.register) appCommands.register(openCardCommand);
  else app.slots.commandPaletteAction(openCardCommand);

  app.slots.messageDirective({
    id: "stelow-artifact",
    component: StelowArtifactDirective,
  });

  app.slots.messageDirective({
    id: "stelow-quality",
    component: StelowQualityDirective,
  });
});
