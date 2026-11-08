import { useMemo, useState } from "react";
import { BulkActionButtons } from "./bulk-action-buttons";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { toast } from "sonner";
import {
  canBulkArchive,
  canBulkDelete,
  canBulkStart,
  partitionByEligibility,
} from "../../lib/bulk-eligibility.mjs";
import { deleteInBatches } from "../../lib/bulk-delete-batch.mjs";
import { BULK_BAR_SHELL_CLASS, BULK_BAR_SURFACE_CLASS } from "../../lib/bulk-bar-placement.mjs";
import type { BuildPanelState } from "../panels/build-panel-types";

type Card = {
  id: string;
  displayName: string;
  status: string;
  activity: string;
  worker_thread_id?: string | null;
  workerThreadId: string | null;
};

type Props = {
  cards: Card[];
  selectedIds: Set<string>;
  /** The ids this board is showing — the reach of `Select all`. */
  presentIds: string[];
  onClear: () => void;
  onSelectAll: () => void;
  onExit: () => void;
  onSuccess: () => void;
  rpc: {
    call: (
      method: string,
      input: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  };
};

function selectedCards(cards: Card[], ids: Set<string>): Card[] {
  const map = new Map(cards.map((c) => [c.id, c]));
  return [...ids].map((id) => map.get(id)).filter(Boolean) as Card[];
}

type BulkPartition = {
  eligible: Card[];
  skipped: Array<{ card: Card; reason: string | null }>;
};

type BulkOutcome = { started: string[]; failed: Array<{ cardId: string; error: string }> };

// One per-card RPC loop for every bulk verb that acts card-by-card (start,
// archive): guard, calls, honest toasts. Delete stays separate — it batches
// through deleteInBatches rather than one call per card.
async function runBulkPerCard({ eligible, skipped, call, emptyError, successOf, failOf }: {
  eligible: Card[];
  skipped: BulkPartition["skipped"];
  call: (card: Card) => Promise<{ ok: boolean; error: string | null }>;
  emptyError: string;
  successOf: (done: string[]) => string | null;
  failOf: (failed: BulkOutcome["failed"], skippedCount: number) => string | null;
}): Promise<boolean> {
  if (eligible.length === 0) {
    toast.error(emptyError);
    return false;
  }
  const done: string[] = [];
  const failed: BulkOutcome["failed"] = [];
  for (const card of eligible) {
    try {
      const result = await call(card);
      if (result.ok) done.push(card.id);
      else failed.push({ cardId: card.id, error: String(result.error ?? "failed") });
    } catch (err) {
      failed.push({ cardId: card.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  const success = successOf(done);
  if (success) toast.success(success);
  const fail = failOf(failed, skipped.length);
  if (fail) toast.error(fail);
  if (skipped.length) {
    const names = skipped.map((s) => s.card.displayName).join(", ");
    toast.message(`${skipped.length} skipped: ${names}`);
  }
  return true;
}

// One bulk verb, straight through: guard, per-card calls, honest toasts.
// Split out because three of these inline is what pushed the bar past its
// function budget — each verb reads alone now, and the bar only routes.
async function runBulkStart(eligible: Card[], skipped: BulkPartition["skipped"], rpc: Props["rpc"]): Promise<boolean> {
  return runBulkPerCard({
    eligible,
    skipped,
    call: (card) => rpc.call("startWorker", { cardId: card.id }) as Promise<{ ok: boolean; error: string | null }>,
    emptyError: `No cards can start — ${skipped.map((s) => s.reason).join(", ")}`,
    successOf: (started) => started.length ? `Started ${started.length} of ${eligible.length}` : null,
    failOf: (failed) => failed.length ? `${failed.length} failed — ${failed.map((f) => f.error).join("; ")}` : null,
  });
}

async function runBulkArchive(eligible: Card[], skipped: BulkPartition["skipped"], rpc: Props["rpc"]): Promise<boolean> {
  return runBulkPerCard({
    eligible,
    skipped,
    call: (card) => rpc.call("moveCard", { cardId: card.id, status: "archived" }) as Promise<{ ok: boolean; error: string | null }>,
    emptyError: "No cards can be archived",
    successOf: (archived) => archived.length ? `Archived ${archived.length}` : null,
    failOf: (failed) => failed.length ? `${failed.length} failed` : null,
  });
}

async function runBulkDelete(eligible: Card[], skipped: BulkPartition["skipped"], rpc: Props["rpc"]): Promise<boolean> {
  if (eligible.length === 0) {
    toast.error("Only archived cards can be deleted");
    return false;
  }
  const ids = eligible.map((c) => c.id);
  const batchCall = (batch: string[]) =>
    rpc.call("deleteArchivedCards", { cardIds: batch }) as never;
  const fallback = {
    deleted: [],
    failed: ids.map((id) => ({ cardId: id, error: "delete failed" })),
  };
  const result = await deleteInBatches(batchCall, ids).catch(() => fallback);
  const deleted = (result as { deleted: string[] }).deleted ?? [];
  const failed = (result as { failed: Array<{ cardId: string; error: string }> }).failed ?? [];
  if (deleted.length) toast.success(`Deleted ${deleted.length}`);
  if (failed.length) toast.error(`${failed.length} failed`);
  if (skipped.length) toast.message(`${skipped.length} skipped — only archived`);
  return true;
}

/**
 * The bulk bar, floating at the bottom of the viewport while the board is in
 * select mode.
 *
 * It used to be a block ABOVE the kanban, in the board's own column, so selecting a card
 * inserted a row into the layout and pushed the board down. A selection is not a layout
 * change: the cards stay where they are and only the actions appear. See
 * lib/bulk-bar-placement.mjs for why it is anchored to the viewport rather than the board,
 * and for the safe-area handling.
 *
 * It renders whenever the MODE is on, not whenever the count is non-zero. That
 * difference is the whole exit: the bar carries `Done` (leaving the mode), and a
 * bar that vanished at zero selection would leave a reader with an armed board,
 * no selection mark outside it, and no visible way back to normal.
 *
 * `presentIds` is what the board is currently showing, and it is what
 * `Select all` may reach. A bulk verb scoped to everything a filter left on
 * screen is the same promise the archived-column delete makes, and "all" that
 * silently included cards the reader cannot see would be a wider blast radius
 * than the button says.
 */
export function BulkBarSlot({ state }: { state: BuildPanelState }) {
  if (!state.selectMode) return null;
  const presentIds = Object.values(state.grouped).flat().map((card) => card.id);
  return (
    <div className={BULK_BAR_SHELL_CLASS} data-bulk-bar>
      <BuildBulkBar
        cards={state.cards as never}
        selectedIds={state.selectedIds}
        presentIds={presentIds}
        onClear={state.clearSelection}
        onSelectAll={() => presentIds.forEach((id) => {
          if (!state.selectedIds.has(id)) state.toggleSelection(id);
        })}
        onExit={state.exitSelectMode}
        onSuccess={() =>
          state.rpc.call("listCards", {}).catch(() => undefined)
        }
        rpc={state.rpc as never}
      />
    </div>
  );
}

type BulkVerb = "start" | "archive" | "delete";

type BulkRunner = (eligible: Card[], skipped: BulkPartition["skipped"], rpc: Props["rpc"]) => Promise<boolean>;

// Owns the bar's working state: which verb is confirming or running, the
// eligibility split, and the three handlers. The bar itself only renders.
function useBulkActions({ selected, rpc, onClear, onSuccess }: {
  selected: Card[];
  rpc: Props["rpc"];
  onClear: () => void;
  onSuccess: () => void;
}) {
  const [pending, setPending] = useState<BulkVerb | null>(null);
  const [confirm, setConfirm] = useState<BulkVerb | null>(null);
  const partitioned = useMemo(() => ({
    start: partitionByEligibility(selected, canBulkStart),
    archive: partitionByEligibility(selected, canBulkArchive),
    delete: partitionByEligibility(selected, canBulkDelete),
  }), [selected]);
  const run = async (verb: BulkVerb, runner: BulkRunner, part: BulkPartition) => {
    setPending(verb);
    const ran = await runner(part.eligible, part.skipped, rpc);
    setPending(null);
    setConfirm(null);
    if (ran) {
      onClear();
      onSuccess();
    }
  };
  return {
    pending,
    confirm,
    setConfirm,
    partitioned,
    handleStart: () => run("start", runBulkStart, partitioned.start),
    handleArchive: () => run("archive", runBulkArchive, partitioned.archive),
    handleDelete: () => run("delete", runBulkDelete, partitioned.delete),
  };
}

export function BuildBulkBar({ cards, selectedIds, presentIds, onClear, onSelectAll, onExit, onSuccess, rpc }: Props) {
  const count = selectedIds.size;
  const selected = selectedCards(cards, selectedIds);
  const actions = useBulkActions({ selected, rpc, onClear, onSuccess });
  const { pending, confirm, setConfirm, partitioned } = actions;
  if (count === 0) return null;
  const specs = bulkDialogSpecs({
    confirm,
    pending,
    partitioned,
    onStart: () => void actions.handleStart(),
    onArchive: () => void actions.handleArchive(),
    onDelete: () => void actions.handleDelete(),
  });

  return (
    <div className={BULK_BAR_SURFACE_CLASS} data-bulk-bar-surface>
      <BulkActionButtons
        count={count}
        present={presentIds.length}
        pending={pending}
        startEligible={partitioned.start.eligible.length}
        archiveEligible={partitioned.archive.eligible.length}
        deleteEligible={partitioned.delete.eligible.length}
        onStart={() => setConfirm("start")}
        onArchive={() => setConfirm("archive")}
        onDelete={() => setConfirm("delete")}
        onSelectAll={onSelectAll}
        onClear={onClear}
        onExit={onExit}
      />
      <BulkConfirmDialogs specs={specs} onClose={() => setConfirm(null)} />
    </div>
  );
}

type DialogSpec = {
  key: BulkVerb;
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "destructive";
  onConfirm: () => void;
};

// The three confirmation dialogs differ only in words and handlers, so they
// are data: a fourth copy would be the duplication the bar was split to
// remove. Each states exactly what will happen and what will be skipped.
function bulkDialogSpecs({ confirm, pending, partitioned, onStart, onArchive, onDelete }: {
  confirm: BulkVerb | null;
  pending: BulkVerb | null;
  partitioned: { start: BulkPartition; archive: BulkPartition; delete: BulkPartition };
  onStart: () => void;
  onArchive: () => void;
  onDelete: () => void;
}): DialogSpec[] {
  const start = partitioned.start;
  const archive = partitioned.archive;
  const dupe = partitioned.delete;
  return [
    {
      key: "start",
      open: confirm === "start",
      title: `Start ${start.eligible.length} card(s)?`,
      description: `${start.eligible.length} will start`
        + `${start.skipped.length ? `, ${start.skipped.length} skipped: ${start.skipped.map((s) => s.reason).join(", ")}` : ""}.`,
      confirmLabel: pending === "start" ? "Starting…" : `Start ${start.eligible.length}`,
      onConfirm: onStart,
    },
    {
      key: "archive",
      open: confirm === "archive",
      title: `Archive ${archive.eligible.length} card(s)?`,
      description: `${archive.eligible.length} will be archived`
        + `${archive.skipped.length ? `, ${archive.skipped.length} skipped` : ""}. Archived cards stay recoverable via Restore.`,
      confirmLabel: pending === "archive" ? "Archiving…" : `Archive ${archive.eligible.length}`,
      onConfirm: onArchive,
    },
    {
      key: "delete",
      open: confirm === "delete",
      title: `Delete ${dupe.eligible.length} archived card(s)?`,
      description: `${dupe.eligible.length} archived card(s) will be permanently deleted, rows `
        + `and run files removed${dupe.skipped.length ? `, ${dupe.skipped.length} non-archived skipped` : ""}. This cannot be undone.`,
      confirmLabel: pending === "delete" ? "Deleting…" : `Delete ${dupe.eligible.length}`,
      tone: "destructive",
      onConfirm: onDelete,
    },
  ];
}

function BulkConfirmDialogs({ specs, onClose }: { specs: DialogSpec[]; onClose: () => void }) {
  return (
    <>
      {specs.map((spec) => (
        <ConfirmActionDialog
          key={spec.key}
          open={spec.open}
          onOpenChange={(next) => { if (!next) onClose(); }}
          title={spec.title}
          description={spec.description}
          confirmLabel={spec.confirmLabel}
          confirmTone={spec.tone}
          onConfirm={spec.onConfirm}
        />
      ))}
    </>
  );
}
