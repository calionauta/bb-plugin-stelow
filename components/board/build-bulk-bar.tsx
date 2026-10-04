import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { toast } from "sonner";
import {
  canBulkArchive,
  canBulkDelete,
  canBulkStart,
  partitionByEligibility,
} from "../../lib/bulk-eligibility.mjs";
import { deleteInBatches } from "../../lib/bulk-delete-batch.mjs";
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
  onClear: () => void;
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

// One bulk verb, straight through: guard, per-card calls, honest toasts.
// Split out because three of these inline is what pushed the bar past its
// function budget — each verb reads alone now, and the bar only routes.
async function runBulkStart(eligible: Card[], skipped: BulkPartition["skipped"], rpc: Props["rpc"]): Promise<boolean> {
  if (eligible.length === 0) {
    toast.error(`No cards can start — ${skipped.map((s) => s.reason).join(", ")}`);
    return false;
  }
  const started: string[] = [];
  const failed: BulkOutcome["failed"] = [];
  for (const card of eligible) {
    try {
      const result = await rpc.call("startWorker", { cardId: card.id }) as {
        ok: boolean; error: string | null;
      };
      if (result.ok) started.push(card.id);
      else failed.push({ cardId: card.id, error: String(result.error ?? "failed") });
    } catch (err) {
      failed.push({ cardId: card.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  if (started.length) toast.success(`Started ${started.length} of ${eligible.length}`);
  if (failed.length) toast.error(`${failed.length} failed — ${failed.map((f) => f.error).join("; ")}`);
  if (skipped.length) {
    const names = skipped.map((s) => s.card.displayName).join(", ");
    toast.message(`${skipped.length} skipped: ${names}`);
  }
  return true;
}

async function runBulkArchive(eligible: Card[], skipped: BulkPartition["skipped"], rpc: Props["rpc"]): Promise<boolean> {
  if (eligible.length === 0) {
    toast.error("No cards can be archived");
    return false;
  }
  const archived: string[] = [];
  const failed: BulkOutcome["failed"] = [];
  for (const card of eligible) {
    try {
      const result = await rpc.call("moveCard", {
        cardId: card.id,
        status: "archived",
      }) as { ok: boolean; error: string | null };
      if (result.ok) archived.push(card.id);
      else failed.push({ cardId: card.id, error: String(result.error ?? "failed") });
    } catch (err) {
      failed.push({ cardId: card.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  if (archived.length) toast.success(`Archived ${archived.length}`);
  if (failed.length) toast.error(`${failed.length} failed`);
  if (skipped.length) toast.message(`${skipped.length} skipped`);
  return true;
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
 * The bulk bar above the kanban, present only while cards are selected. It
 * lives with the bar it renders: the board view only routes view modes to
 * boards, while everything about selection actions stays in this file.
 */
export function BulkBarSlot({ state }: { state: BuildPanelState }) {
  if (state.selectedIds.size === 0) return null;
  return (
    <div className="mb-3">
      <BuildBulkBar
        cards={state.cards as never}
        selectedIds={state.selectedIds}
        onClear={state.clearSelection}
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

export function BuildBulkBar({ cards, selectedIds, onClear, onSuccess, rpc }: Props) {
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
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
      <BulkActionButtons
        count={count}
        pending={pending}
        startEligible={partitioned.start.eligible.length}
        archiveEligible={partitioned.archive.eligible.length}
        deleteEligible={partitioned.delete.eligible.length}
        onStart={() => setConfirm("start")}
        onArchive={() => setConfirm("archive")}
        onDelete={() => setConfirm("delete")}
        onClear={onClear}
      />
      <BulkConfirmDialogs specs={specs} onClose={() => setConfirm(null)} />
    </div>
  );
}

/**
 * The four bar buttons: one per bulk verb plus Clear. Labels carry live
 * counts, and a verb with nothing eligible stays disabled rather than
 * erroring after the click.
 */
function BulkActionButtons({ count, pending, startEligible, archiveEligible, deleteEligible, onStart, onArchive, onDelete, onClear }: {
  count: number;
  pending: "start" | "archive" | "delete" | null;
  startEligible: number;
  archiveEligible: number;
  deleteEligible: number;
  onStart: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <span className="text-sm font-medium">{count} selected</span>
      <Button
        variant="outline"
        className="min-h-11 cursor-pointer"
        disabled={pending !== null || startEligible === 0}
        onClick={onStart}
      >
        {pending === "start" ? "Starting…" : `Start (${startEligible})`}
      </Button>
      <Button
        variant="outline"
        className="min-h-11 cursor-pointer"
        disabled={pending !== null || archiveEligible === 0}
        onClick={onArchive}
      >
        {pending === "archive" ? "Archiving…" : `Archive (${archiveEligible})`}
      </Button>
      <Button
        variant="destructive"
        className="min-h-11 cursor-pointer"
        disabled={pending !== null || deleteEligible === 0}
        onClick={onDelete}
      >
        {pending === "delete" ? "Deleting…" : `Delete (${deleteEligible})`}
      </Button>
      <Button variant="ghost" className="min-h-11 cursor-pointer" onClick={onClear}>
        Clear
      </Button>
    </>
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
