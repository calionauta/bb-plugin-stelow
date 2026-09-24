import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  markPluginUpdateLoaded,
  markPluginUpdateUnloaded,
  pluginUpdateSnapshot,
  setPluginUpdateAvailable,
  subscribePluginUpdate,
} from "./lib/plugin-update-signal.mjs";
import { AboutPanel } from "./components/settings/about-panel";
import { UpdateBadge } from "./components/settings/update-badge";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  type PluginCommandRegistration,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { updateAvailableFrom } from "./lib/plugin-update.mjs";
import { inboxBadgeCount } from "./lib/inbox-panel-state.mjs";
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
import { StelowArtifactDirective } from "./components/messages/stelow-artifact-directive";
import { StelowQualityDirective } from "./components/messages/stelow-quality-directive";
import { OpenStelowAction } from "./components/thread/open-stelow-action";
import type { rpcContract } from "./server";

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

function StelowInboxSidebarAccessory() {
  const { count, tone } = useInboxAccessory();
  const updateAvailable = usePluginUpdateSignal();
  return <span className="inline-flex items-center gap-1"><SidebarCount count={count} tone={tone} label={`${count} Stelow Inbox items need attention`} />{updateAvailable ? <UpdateBadge label="Stelow plugin update available" /> : null}</span>;
}

function usePluginUpdateSignal(): boolean {
  const rpc = useRpc<typeof rpcContract>();
  const available = useSyncExternalStore(subscribePluginUpdate, pluginUpdateSnapshot, pluginUpdateSnapshot);
  useEffect(() => {
    if (!markPluginUpdateLoaded()) return;
    void rpc.call("buildInfo", {}).then((info) => {
      setPluginUpdateAvailable(updateAvailableFrom(info));
    }).catch(() => markPluginUpdateUnloaded());
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
