import { Pill } from "../dashboard/build-status-pills";
import { Button } from "@/components/ui/button";
import type { PresetManagerPreset } from "./preset-manager-types";

/**
 * The row's reasoning level, and the one place a stored level stops being
 * presented as honoured. The host enum admits eight levels and each provider
 * declares a subset of them, so a level that passes the storage CHECK can still
 * be one this provider never declared — the card then runs at the provider's
 * default while the row reads as the choice that was made.
 *
 * `false` says so in words, because a pill on its own would leave the reader
 * guessing which of the two words is meant. `null` is the roster's silence and
 * is rendered as the level with a "not verified" marker: unproven is not the
 * same as broken, and saying so is the honest reading.
 */
function LevelFact({ preset }: { preset: PresetManagerPreset }) {
  if (preset.reasoningLevelSupported === false) {
    return (
      <span title={`${preset.providerId} does not declare this level — the card runs at the provider's default effort.`}>
        {preset.reasoningLevel} (unsupported here)
      </span>
    );
  }
  if (preset.reasoningLevelSupported === null) {
    return (
      <span title="The host did not report a level ladder for this provider, so this level is unverified.">
        {preset.reasoningLevel} (not verified)
      </span>
    );
  }
  return <>{preset.reasoningLevel}</>;
}

export type PresetManagerRowProps = {
  preset: PresetManagerPreset;
  busy: boolean;
  onEdit: (preset: PresetManagerPreset) => void;
  onSetDefault: (preset: PresetManagerPreset) => void;
  onDelete: (preset: PresetManagerPreset) => void;
};

/**
 * One preset's row. Split out of `PresetManagerList` so the list can gain the
 * worktree indicator without growing a function that already sits at its
 * recorded ceiling.
 *
 * The indicator is a Pill beside the meta line, never inside it: the meta
 * content sits in a `truncate` span, so anything added in there is
 * ellipsised and never renders. Absence reads as "not a worktree preset", so
 * only the affirmative case spends a Pill.
 */
export function PresetManagerPresetRow(props: PresetManagerRowProps) {
  const { preset, busy, onEdit, onSetDefault, onDelete } = props;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{preset.name}</span>
        <span className="ml-2 text-muted-foreground">
          {preset.providerId}/{preset.modelId} · <LevelFact preset={preset} /> ·{" "}
          {preset.permissionMode}
        </span>
      </span>
      {preset.isDefault ? (
        <Pill tone="bg-primary/15 text-primary">default</Pill>
      ) : null}
      {preset.builtIn ? <Pill>built-in</Pill> : null}
      {preset.environmentKind === "new-worktree" ? <Pill>worktree</Pill> : null}
      <PresetManagerRowActions
        preset={preset}
        busy={busy}
        onEdit={onEdit}
        onSetDefault={onSetDefault}
        onDelete={onDelete}
      />
    </div>
  );
}

/**
 * The row's buttons. A preset that is already the default has nothing to set,
 * and a built-in cannot be deleted, so each button is conditional on the fact
 * that decides it rather than on the row as a whole.
 */
function PresetManagerRowActions({
  preset,
  busy,
  onEdit,
  onSetDefault,
  onDelete,
}: PresetManagerRowProps) {
  return (
    <div className="flex shrink-0 gap-1">
      {!preset.isDefault ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onSetDefault(preset)}
        >
          Set default
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onEdit(preset)}
      >
        Edit
      </Button>
      {!preset.builtIn ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onDelete(preset)}
        >
          Delete
        </Button>
      ) : null}
    </div>
  );
}