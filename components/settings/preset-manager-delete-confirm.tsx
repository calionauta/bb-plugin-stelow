import { ConfirmActionDialog } from "../confirm-action-dialog";
import {
  describePresetDeleteImpact,
  presetDeleteDescription,
} from "../../lib/preset-delete-refs.mjs";
import type { PresetManagerAssignments } from "./preset-manager-assignments";
import type { PresetManagerCrud } from "./preset-manager-crud";

type PresetManagerDeleteConfirmProps = {
  crud: Pick<PresetManagerCrud, "pendingDelete" | "cancelDelete" | "confirmDelete">;
  assignments: PresetManagerAssignments;
};

/**
 * The delete behind a confirmation. The dialog names what the delete takes
 * with it: bands, roles and default-ness are already loaded by the
 * assignments hook, so the confirm names them before the click — while
 * card pins are not (no usage-count RPC exists), so those stay a
 * post-confirm server message rather than a pre-confirm claim.
 *
 * Split out of `PresetManagerDialog` so the shell can gain the delete
 * confirmation without growing a function that already sits at its
 * recorded ceiling.
 */
export function PresetManagerDeleteConfirm({ crud, assignments }: PresetManagerDeleteConfirmProps) {
  const pending = crud.pendingDelete;
  const impact = pending
    ? describePresetDeleteImpact(pending.id, {
      bands: assignments.bands,
      generationPreset: assignments.generationPreset,
      reliablePreset: assignments.reliablePreset,
      reviewerPreset: assignments.reviewerPreset,
      isDefault: pending.isDefault,
    })
    : null;
  return (
    <ConfirmActionDialog
      open={pending !== null}
      onOpenChange={(next) => {
        if (!next) crud.cancelDelete();
      }}
      title={pending ? `Delete preset "${pending.name}"?` : "Delete preset?"}
      description={
        pending && impact
          ? presetDeleteDescription(pending.name, impact)
          : "Removes this agent preset."
      }
      confirmLabel="Delete preset"
      confirmTone="destructive"
      onConfirm={() => crud.confirmDelete()}
    />
  );
}
