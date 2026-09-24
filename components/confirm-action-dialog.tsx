import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// One destructive-confirm shape for the whole panel: explicit title,
// blast-radius description, cancel + pending-guarded confirm. Callers
// supply copy from lib (discardConfirm, cleanupConfirm) — never inline.
export function ConfirmActionDialog({ open, onOpenChange, title, description, confirmLabel, confirmTone, onConfirm }: { open: boolean; onOpenChange: (next: boolean) => void; title: string; description: string; confirmLabel: string; confirmTone?: "destructive" | "default"; onConfirm: () => void | Promise<void> }) {
  const [pending, setPending] = useState(false);
  useEffect(() => { if (!open) setPending(false); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>Cancel</Button>
          </DialogClose>
          <Button variant={confirmTone === "destructive" ? "destructive" : "default"} disabled={pending} onClick={async () => { setPending(true); try { await onConfirm(); } finally { setPending(false); } }}>{pending ? "Working…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
