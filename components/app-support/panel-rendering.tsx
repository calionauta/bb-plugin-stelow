import type { ReactNode } from "react";
import { BuildPanel } from "../panels/build-panel";
import { TrackPanelForKind } from "../panels/track-panel";
import {
  EXPLORE_PANEL_CONFIG,
  RESEARCH_PANEL_CONFIG,
} from "../panels/track-panel-state";
import {
  EXPLORE_VIEW_CONFIG,
  RESEARCH_VIEW_CONFIG,
} from "../panels/track-panel-view";
import {
  EXPLORE_DIALOGS_CONFIG,
  RESEARCH_DIALOGS_CONFIG,
} from "../panels/track-panel-dialogs";
import { InboxPanel } from "../panels/inbox-panel";
import { AboutPanel } from "../settings/about-panel";
import { PresetOnboardingDialog } from "../settings/preset-onboarding";
import { PresetManagerDialog } from "../settings/preset-manager-shell";
import { BareCardRoute, StelowCardDetail, INTENT_LABEL } from "../detail/card-detail-route";
import type { ParsedStelowRoute, StelowTrack } from "../panel/stelow-route.mjs";
import type { BbNavigateHandle } from "./navigation";

export type PresetDialogRendererProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onChanged: () => void;
};

export function renderTrackPanel(tab: StelowTrack, active: boolean) {
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
      <TrackPanelForKind
        active={active}
        renderOnboarding={(props) => <PresetOnboardingDialog {...props} />}
        renderPresetManager={(props) => <PresetManagerDialog {...props} />}
        panelConfig={RESEARCH_PANEL_CONFIG}
        viewConfig={RESEARCH_VIEW_CONFIG}
        dialogsConfig={RESEARCH_DIALOGS_CONFIG}
      />
    );
  }
  if (tab === "explore") {
    return (
      <TrackPanelForKind
        active={active}
        renderOnboarding={(props) => <PresetOnboardingDialog {...props} />}
        renderPresetManager={(props) => <PresetManagerDialog {...props} />}
        panelConfig={EXPLORE_PANEL_CONFIG}
        viewConfig={EXPLORE_VIEW_CONFIG}
        dialogsConfig={EXPLORE_DIALOGS_CONFIG}
      />
    );
  }
  return <AboutPanel />;
}

export function renderCardRoute(
  route: ParsedStelowRoute,
  navigate: BbNavigateHandle,
  onOpenRecoveryAudit: (cardId: string) => void,
  renderPresetDialog: (cardId: string, props: PresetDialogRendererProps) => ReactNode,
) {
  const shared = { navigate, intentLabels: INTENT_LABEL, onOpenRecoveryAudit, renderPresetDialog };
  if (route.kind === "bare-card") {
    return <BareCardRoute cardId={route.cardId} eventId={route.eventId} executionRunId={route.executionRunId} {...shared} />;
  }
  if (route.kind === "card") {
    return (
      <StelowCardDetail
        cardId={route.cardId}
        eventId={route.eventId}
        executionRunId={route.executionRunId}
        backTrack={route.origin}
        {...shared}
      />
    );
  }
  return null;
}
