import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { buildDiscardConfirmation, buildLifecycleOutcome, type BuildLifecycleAction } from "../../lib/build-detail-lifecycle.mjs";

type BuildLifecycleCard = { displayName: string; workspaceKind: string | null } | null;
type LifecycleOptions = {
  cardId: string;
  card: BuildLifecycleCard;
  intentLabels: Record<string, string>;
  onChanged: () => void | Promise<void>;
  onClose: () => void;
  onOpenRecoveryAudit: (cardId: string) => void;
};
type LifecycleResult = Parameters<typeof buildLifecycleOutcome>[1];
type LifecycleContext = Parameters<typeof buildLifecycleOutcome>[2];

function reportOutcome(action: BuildLifecycleAction, result: LifecycleResult, context?: LifecycleContext, setSplitError?: Dispatch<SetStateAction<string | null>>) {
  const outcome = buildLifecycleOutcome(action, result, context);
  if (!outcome.ok) {
    if (action === "split") setSplitError?.(outcome.error ?? null);
    else toast.error(outcome.error ?? "The action failed.");
  } else {
    if (action === "split") setSplitError?.(null);
    toast.success(outcome.success ?? "Done.");
  }
  return outcome;
}

function useRemovalState(cardId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState<{ title: string; body: string } | null>(null);

  async function openDiscard() {
    try {
      const preview = buildDiscardConfirmation(await rpc.call("discardPreview", { cardId }));
      if (!preview.eligible) return toast.error(preview.error);
      setDiscardConfirm(preview.confirmation);
      setDiscardOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not inspect the checkout.");
    }
  }
  return { archiveOpen, setArchiveOpen, deleteOpen, setDeleteOpen, discardOpen, setDiscardOpen, discardConfirm, openDiscard };
}

function useRemovalActions(cardId: string, onClose: () => void, state: ReturnType<typeof useRemovalState>) {
  const rpc = useRpc<typeof rpcContract>();
  async function doArchive() {
    state.setArchiveOpen(false);
    try {
      const outcome = reportOutcome("archive", await rpc.call("cancelCard", { cardId }));
      if (outcome.close) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed.");
    }
  }
  async function doDelete() {
    state.setDeleteOpen(false);
    const outcome = reportOutcome("delete", await rpc.call("deleteCard", { cardId }));
    if (outcome.close) onClose();
  }
  async function doDiscard() {
    state.setDiscardOpen(false);
    try {
      const outcome = reportOutcome("discard", await rpc.call("discardCardChanges", { cardId }));
      if (outcome.close) onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Discard failed.");
    }
  }
  return { ...state, doArchive, doDelete, doDiscard };
}

function useWorkerResumeActions(cardId: string, onChanged: () => void | Promise<void>) {
  const rpc = useRpc<typeof rpcContract>();
  const [restarting, setRestarting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [restartWorkerOpen, setRestartWorkerOpen] = useState(false);

  async function doRetry() {
    setRetrying(true);
    try {
      reportOutcome("retry", await rpc.call("retryWorker", { cardId }));
      await onChanged();
    } finally { setRetrying(false); }
  }
  async function doRestartWorker() {
    setRestartWorkerOpen(false);
    setRestarting(true);
    try {
      reportOutcome("restart", await rpc.call("restartWorker", { cardId }));
      await onChanged();
    } finally { setRestarting(false); }
  }
  async function doStart() {
    setStarting(true);
    try {
      reportOutcome("start", await rpc.call("startWorker", { cardId }));
      await onChanged();
    } finally { setStarting(false); }
  }
  return { restarting, retrying, starting, restartWorkerOpen, setRestartWorkerOpen, doRetry, doRestartWorker, doStart };
}

function useRepairAndSplitActions(cardId: string, intentLabels: Record<string, string>, onChanged: () => void | Promise<void>) {
  const rpc = useRpc<typeof rpcContract>();
  const [repairOpen, setRepairOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  async function doRepair(intent?: string): Promise<boolean> {
    setRepairOpen(false);
    const result = await rpc.call("reseedCard", { cardId, ...(intent ? { intent: intent as "new-product" | "feature" | "bugfix" | "refactor" | "investigate" | "unknown" } : {}) });
    const outcome = reportOutcome("repair", result, { intent, intentLabels });
    if (outcome.ok) await onChanged();
    return outcome.ok;
  }
  async function doRequestSplit() {
    setSplitting(true);
    setSplitError(null);
    try {
      const outcome = reportOutcome("split", await rpc.call("requestSplitProposal", { cardId }), undefined, setSplitError);
      if (outcome.ok) await onChanged();
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : "Could not request a split.");
    } finally { setSplitting(false); }
  }
  return { repairOpen, setRepairOpen, splitting, splitError, doRepair, doRequestSplit };
}

function useWorkspaceRecovery(cardId: string, card: BuildLifecycleCard) {
  const rpc = useRpc<typeof rpcContract>();
  type WorkspaceRecovery = Awaited<ReturnType<typeof rpc.call<"workspaceRecovery">>>;
  const [workspaceRecovery, setWorkspaceRecovery] = useState<WorkspaceRecovery | null>(null);
  const [workspaceRecoveryLoading, setWorkspaceRecoveryLoading] = useState(false);
  const loadWorkspaceRecovery = useCallback(async () => {
    if (card?.workspaceKind !== "exploratory") return setWorkspaceRecovery(null);
    setWorkspaceRecoveryLoading(true);
    try { setWorkspaceRecovery(await rpc.call("workspaceRecovery", { cardId })); }
    catch { setWorkspaceRecovery(null); }
    finally { setWorkspaceRecoveryLoading(false); }
  }, [card?.workspaceKind, cardId, rpc]);
  return { workspaceRecovery, workspaceRecoveryLoading, loadWorkspaceRecovery };
}

function usePromotionActions(cardId: string, card: BuildLifecycleCard, onChanged: () => void | Promise<void>) {
  const rpc = useRpc<typeof rpcContract>();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteName, setPromoteName] = useState("");
  const [promoting, setPromoting] = useState(false);
  async function doPromote() {
    if (!card) return;
    setPromoting(true);
    try {
      const outcome = reportOutcome("promote", await rpc.call("promoteCard", { cardId, name: promoteName.trim() || card.displayName }));
      if (outcome.ok) { setPromoteOpen(false); await onChanged(); }
    } finally { setPromoting(false); }
  }
  return { promoteOpen, setPromoteOpen, promoteName, setPromoteName, promoting, doPromote };
}

function useRecoveryActions(cardId: string, onChanged: () => void | Promise<void>, onOpenRecoveryAudit: (cardId: string) => void, recovery: ReturnType<typeof useWorkspaceRecovery>) {
  const rpc = useRpc<typeof rpcContract>();
  const [recoveryAttachProjectId, setRecoveryAttachProjectId] = useState<string | null>(null);
  const [creatingRecoveryAudit, setCreatingRecoveryAudit] = useState(false);
  async function doAttachRecoveryCheckout() {
    if (!recoveryAttachProjectId) return;
    const outcome = reportOutcome("attach-recovery", await rpc.call("attachRecoveryCheckout", { cardId, projectId: recoveryAttachProjectId }));
    if (!outcome.ok) return;
    setRecoveryAttachProjectId(null);
    await Promise.all([recovery.loadWorkspaceRecovery(), onChanged()]);
  }
  async function doCreateRecoveryAudit() {
    setCreatingRecoveryAudit(true);
    try {
      const outcome = reportOutcome("create-recovery-audit", await rpc.call("createRecoveryAudit", { cardId }));
      if (!outcome.ok) return;
      await Promise.all([recovery.loadWorkspaceRecovery(), onChanged()]);
      if (outcome.auditCardId) onOpenRecoveryAudit(outcome.auditCardId);
    } finally { setCreatingRecoveryAudit(false); }
  }
  return { recoveryAttachProjectId, setRecoveryAttachProjectId, creatingRecoveryAudit, doAttachRecoveryCheckout, doCreateRecoveryAudit };
}

export function useBuildDetailLifecycle({ cardId, card, intentLabels, onChanged, onClose, onOpenRecoveryAudit }: LifecycleOptions) {
  const recovery = useWorkspaceRecovery(cardId, card);
  const removalState = useRemovalState(cardId);
  const removal = useRemovalActions(cardId, onClose, removalState);
  const worker = useWorkerResumeActions(cardId, onChanged);
  const repair = useRepairAndSplitActions(cardId, intentLabels, onChanged);
  const promotion = usePromotionActions(cardId, card, onChanged);
  const recoveryActions = useRecoveryActions(cardId, onChanged, onOpenRecoveryAudit, recovery);
  return { ...removal, ...worker, ...repair, ...recovery, ...promotion, ...recoveryActions };
}
