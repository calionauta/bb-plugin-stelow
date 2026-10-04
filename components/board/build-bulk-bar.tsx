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

export function BuildBulkBar({ cards, selectedIds, onClear, onSuccess, rpc }: Props) {
  const [pending, setPending] = useState<null | "start" | "archive" | "delete">(null);
  const [confirm, setConfirm] = useState<null | "start" | "archive" | "delete">(null);
  const count = selectedIds.size;
  if (count === 0) return null;
  const selected = selectedCards(cards, selectedIds);
  const partitioned = useMemo(() => ({
    start: partitionByEligibility(selected, canBulkStart),
    archive: partitionByEligibility(selected, canBulkArchive),
    delete: partitionByEligibility(selected, canBulkDelete),
  }), [selected]);

  async function handleStart() {
    const { eligible, skipped } = partitioned.start;
    if (eligible.length === 0) {
      toast.error(`No cards can start — ${skipped.map((s) => s.reason).join(", ")}`);
      return;
    }
    setPending("start");
    let started: string[] = [];
    let failed: Array<{ cardId: string; error: string }> = [];
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
    setPending(null);
    setConfirm(null);
    if (started.length) toast.success(`Started ${started.length} of ${eligible.length}`);
    if (failed.length) toast.error(`${failed.length} failed — ${failed.map((f) => f.error).join("; ")}`);
    if (skipped.length) {
      const names = skipped.map((s) => (s as { card: Card }).card.displayName).join(", ");
      toast.message(`${skipped.length} skipped: ${names}`);
    }
    onClear();
    onSuccess();
  }

  async function handleArchive() {
    const { eligible, skipped } = partitioned.archive;
    if (eligible.length === 0) {
      toast.error("No cards can be archived");
      return;
    }
    setPending("archive");
    let archived: string[] = [];
    let failed: Array<{ cardId: string; error: string }> = [];
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
    setPending(null);
    setConfirm(null);
    if (archived.length) toast.success(`Archived ${archived.length}`);
    if (failed.length) toast.error(`${failed.length} failed`);
    if (skipped.length) toast.message(`${skipped.length} skipped`);
    onClear();
    onSuccess();
  }

  async function handleDelete() {
    const { eligible, skipped } = partitioned.delete;
    if (eligible.length === 0) {
      toast.error("Only archived cards can be deleted");
      return;
    }
    setPending("delete");
    const ids = eligible.map((c) => c.id);
    const batchCall = (batch: string[]) =>
      rpc.call("deleteArchivedCards", { cardIds: batch }) as never;
    const fallback = {
      deleted: [],
      failed: ids.map((id) => ({ cardId: id, error: "delete failed" })),
    };
    const result = await deleteInBatches(batchCall, ids).catch(() => fallback);
    setPending(null);
    setConfirm(null);
    const deleted = (result as { deleted: string[] }).deleted ?? [];
    const failed = (result as { failed: Array<{ cardId: string; error: string }> }).failed ?? [];
    if (deleted.length) toast.success(`Deleted ${deleted.length}`);
    if (failed.length) toast.error(`${failed.length} failed`);
    if (skipped.length) toast.message(`${skipped.length} skipped — only archived`);
    onClear();
    onSuccess();
  }

  const startEligible = partitioned.start.eligible.length;
  const archiveEligible = partitioned.archive.eligible.length;
  const deleteEligible = partitioned.delete.eligible.length;
  const startSkipped = partitioned.start.skipped as Array<{ reason: string | null }>;
  const archiveSkipped = partitioned.archive.skipped as Array<{ reason: string | null }>;
  const deleteSkipped = partitioned.delete.skipped as Array<{ reason: string | null }>;

  const startDesc = `${startEligible} will start${
    startSkipped.length
      ? `, ${startSkipped.length} skipped: ${startSkipped.map((s) => s.reason).join(", ")}`
      : ""
  }.`;
  const archiveDesc = `${archiveEligible} will be archived${
    archiveSkipped.length ? `, ${archiveSkipped.length} skipped` : ""
  }. Archived cards stay recoverable via Restore.`;
  const deleteDesc = `${deleteEligible} archived card(s) will be permanently deleted, rows `
    + `and run files removed${
      deleteSkipped.length ? `, ${deleteSkipped.length} non-archived skipped` : ""
    }. This cannot be undone.`;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
      <span className="text-sm font-medium">{count} selected</span>
      <Button
        variant="outline"
        className="min-h-11 cursor-pointer"
        disabled={pending !== null || startEligible === 0}
        onClick={() => setConfirm("start")}
      >
        {pending === "start" ? "Starting…" : `Start (${startEligible})`}
      </Button>
      <Button
        variant="outline"
        className="min-h-11 cursor-pointer"
        disabled={pending !== null || archiveEligible === 0}
        onClick={() => setConfirm("archive")}
      >
        {pending === "archive" ? "Archiving…" : `Archive (${archiveEligible})`}
      </Button>
      <Button
        variant="destructive"
        className="min-h-11 cursor-pointer"
        disabled={pending !== null || deleteEligible === 0}
        onClick={() => setConfirm("delete")}
      >
        {pending === "delete" ? "Deleting…" : `Delete (${deleteEligible})`}
      </Button>
      <Button variant="ghost" className="min-h-11 cursor-pointer" onClick={onClear}>
        Clear
      </Button>
      <ConfirmActionDialog
        open={confirm === "start"}
        onOpenChange={(next) => { if (!next) setConfirm(null); }}
        title={`Start ${startEligible} card(s)?`}
        description={startDesc}
        confirmLabel={pending === "start" ? "Starting…" : `Start ${startEligible}`}
        onConfirm={() => handleStart()}
      />
      <ConfirmActionDialog
        open={confirm === "archive"}
        onOpenChange={(next) => { if (!next) setConfirm(null); }}
        title={`Archive ${archiveEligible} card(s)?`}
        description={archiveDesc}
        confirmLabel={pending === "archive" ? "Archiving…" : `Archive ${archiveEligible}`}
        onConfirm={() => handleArchive()}
      />
      <ConfirmActionDialog
        open={confirm === "delete"}
        onOpenChange={(next) => { if (!next) setConfirm(null); }}
        title={`Delete ${deleteEligible} archived card(s)?`}
        description={deleteDesc}
        confirmLabel={pending === "delete" ? "Deleting…" : `Delete ${deleteEligible}`}
        confirmTone="destructive"
        onConfirm={() => handleDelete()}
      />
    </div>
  );
}
