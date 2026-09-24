import {
  definePluginApp,
  useBbNavigate,
  type PluginCommandRegistration,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { CardDrawerAdapter, INTENT_LABEL } from "./components/detail/card-detail-route";
import { StelowPanelRoute } from "./components/app-support/panel-route";
import "./components/app-support/stelow-styles.css";
import { StelowInboxSidebarAccessory } from "./components/app-support/sidebar-accessories";
import { STELOW_PANEL_ID, STELOW_PANEL_PATH } from "./components/panel/stelow-route.mjs";
import { goToCard } from "./components/app-support/navigation";
import { registerPendingInteraction } from "./components/conversation/question-form";
import { StelowArtifactDirective } from "./components/messages/stelow-artifact-directive";
import { StelowQualityDirective } from "./components/messages/stelow-quality-directive";
import { OpenStelowAction } from "./components/thread/open-stelow-action";
import { PresetAssignDialog } from "./components/settings/preset-assign-dialog";
import type { PresetDialogRendererProps } from "./components/app-support/panel-rendering";

function StelowCardDrawer(props: PluginThreadPanelProps) {
  const navigate = useBbNavigate();
  const renderPresetDialog = (
    cardId: string,
    { open, onOpenChange, onChanged }: PresetDialogRendererProps,
  ) => (
    <PresetAssignDialog
      open={open}
      onOpenChange={onOpenChange}
      cardId={cardId}
      onChanged={onChanged}
    />
  );
  return (
    <CardDrawerAdapter
      {...props}
      intentLabels={INTENT_LABEL}
      onOpenRecoveryAudit={(cardId) => goToCard(
        navigate,
        { kind: "build" },
        cardId,
      )}
      renderPresetDialog={renderPresetDialog}
    />
  );
}

export default definePluginApp((app) => {
  // One sidebar row for the whole plugin. All tracks live on as subPath
  // routes (see STELOW_TRACKS). The badge counts unresolved inbox action items.
  app.slots.navPanel({
    id: STELOW_PANEL_ID,
    title: "Stelow • Product Hub",
    icon: "Star",
    path: STELOW_PANEL_PATH,
    component: (props) => <StelowPanelRoute subPath={props.subPath} />,
    experimental_sidebarAccessory: StelowInboxSidebarAccessory,
  });
  registerPendingInteraction(app);
  app.slots.threadPanelAction({
    id: "stelow-card-detail",
    title: "Stelow card",
    icon: "Columns2",
    component: StelowCardDrawer,
  });
  app.slots.experimental_threadHeaderAction({
    id: "open-stelow",
    title: "Open Stelow",
    component: OpenStelowAction,
  });

  // Quick-palette command (BB 0.43 `app.commands.register`): from any worker
  // thread, open its Stelow card. The palette context carries no card id, so
  // the drawer resolves threadId itself. Hosts predating `app.commands`
  // keep the deprecated `commandPaletteAction` alias with the same shape.
  const openCardCommand: PluginCommandRegistration = {
    id: "open-card-for-thread",
    title: "Stelow: open card for this thread",
    isAvailable: (context) => context.threadId !== null,
    run: (context) => {
      if (context.threadId) {
        context.openPanel({
          actionId: "stelow-card-detail",
          params: { threadId: context.threadId },
        });
      }
    },
  };
  const appCommands = (app as unknown as {
    commands?: { register: (registration: PluginCommandRegistration) => void };
  }).commands;
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
