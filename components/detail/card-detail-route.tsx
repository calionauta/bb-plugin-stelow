import { useEffect, useState, type ReactNode } from "react";
import {
  useBbNavigate,
  useRpc,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { BuildDetailBody } from "./build-detail-body";
import {
  STELOW_PANEL_ID,
  trackOfCard,
  trackRootSubPath,
  type StelowTrack,
} from "../panel/stelow-route.mjs";

export const INTENT_LABEL: Record<string, string> = {
  "new-product": "New product",
  feature: "Feature",
  bugfix: "Bug fix",
  refactor: "Refactor",
  investigate: "Investigate",
};

type Navigate = ReturnType<typeof useBbNavigate>;
type CardKind = "build" | "research" | "explore";
type PresetDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onChanged: () => void;
};
type PresetDialogRenderer = (cardId: string, props: PresetDialogProps) => ReactNode;

type CardDetailProps = {
  cardId: string;
  eventId: string | null;
  backTrack: StelowTrack;
  navigate: Navigate;
  intentLabels: Record<string, string>;
  onOpenRecoveryAudit: (cardId: string) => void;
  renderPresetDialog: PresetDialogRenderer;
};

function CardRouteSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-label="Loading" aria-busy="true">
      <div className="h-20 animate-pulse rounded-md border bg-muted/30" />
      <div className="h-20 animate-pulse rounded-md border bg-muted/30" />
    </div>
  );
}

export function StelowCardDetail({
  cardId,
  eventId,
  backTrack,
  navigate,
  intentLabels,
  onOpenRecoveryAudit,
  renderPresetDialog,
}: CardDetailProps) {
  const back = () => navigate.toPluginPanel(STELOW_PANEL_ID, { subPath: trackRootSubPath(backTrack) });
  return (
    <BuildDetailBody
      cardId={cardId}
      inboxEventId={eventId}
      onClose={back}
      onBack={back}
      intentLabels={intentLabels}
      onOpenRecoveryAudit={onOpenRecoveryAudit}
      renderPresetDialog={(props) => renderPresetDialog(cardId, props)}
    />
  );
}

type BareCardRouteProps = Omit<CardDetailProps, "backTrack">;

export function BareCardRoute({
  cardId,
  eventId,
  navigate,
  intentLabels,
  onOpenRecoveryAudit,
  renderPresetDialog,
}: BareCardRouteProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [kind, setKind] = useState<CardKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    setKind(null);
    void rpc.call("listCards", { projectId: null }).then((result) => {
      if (cancelled) return;
      const found = result.cards.find((entry) => entry.id === cardId);
      setKind(found ? found.kind : "build");
    }).catch(() => {
      if (!cancelled) setKind("build");
    });
    return () => { cancelled = true; };
  }, [cardId, rpc]);

  if (!kind) return <CardRouteSkeleton />;
  return (
    <StelowCardDetail
      cardId={cardId}
      eventId={eventId}
      backTrack={trackOfCard({ kind })}
      navigate={navigate}
      intentLabels={intentLabels}
      onOpenRecoveryAudit={onOpenRecoveryAudit}
      renderPresetDialog={renderPresetDialog}
    />
  );
}

type CardDrawerAdapterProps = PluginThreadPanelProps & {
  intentLabels: Record<string, string>;
  onOpenRecoveryAudit: (cardId: string) => void;
  renderPresetDialog: PresetDialogRenderer;
};

export function CardDrawerAdapter({
  params,
  intentLabels,
  onOpenRecoveryAudit,
  renderPresetDialog,
}: CardDrawerAdapterProps) {
  const rpc = useRpc<typeof rpcContract>();
  const directCardId = typeof params === "object" && params && "cardId" in params && typeof params.cardId === "string" ? params.cardId : "";
  const threadId = typeof params === "object" && params && "threadId" in params && typeof params.threadId === "string" ? params.threadId : "";
  const [resolvedCardId, setResolvedCardId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (directCardId || !threadId) return;
    let cancelled = false;
    setResolving(true);
    void rpc.call("cardByWorkerThread", { threadId }).then((result) => {
      if (!cancelled) {
        setResolvedCardId(result.cardId);
        setResolving(false);
      }
    }).catch(() => {
      if (!cancelled) setResolving(false);
    });
    return () => { cancelled = true; };
  }, [rpc, directCardId, threadId]);

  const cardId = directCardId || resolvedCardId || "";
  if (!cardId) {
    if (resolving) return <p className="p-4 text-sm text-muted-foreground">Finding this thread&apos;s Stelow card…</p>;
    if (threadId) return <p className="p-4 text-sm text-muted-foreground">This thread is not a Stelow worker thread.</p>;
    return <p className="p-4 text-sm text-muted-foreground">Pick a card from Stelow Build to see its details here.</p>;
  }

  return (
    <BuildDetailBody
      cardId={cardId}
      inboxEventId={null}
      onClose={() => { /* host tab close */ }}
      intentLabels={intentLabels}
      onOpenRecoveryAudit={onOpenRecoveryAudit}
      renderPresetDialog={(props) => renderPresetDialog(cardId, props)}
    />
  );
}
