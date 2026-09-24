import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { StelowPanel } from "../panel/stelow-panel";
import { PresetAssignDialog } from "../settings/preset-assign-dialog";
import { UpdateBadge } from "../settings/update-badge";
import { goToCard, goToTrack } from "./navigation";
import { useBuildAccessory, useInboxAccessory, useResearchAccessory } from "./sidebar-accessories";
import { usePluginUpdateSignal } from "./plugin-update-signal";
import { renderCardRoute, renderTrackPanel, type PresetDialogRendererProps } from "./panel-rendering";

export function StelowPanelRoute({ subPath }: { subPath: string }) {
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
