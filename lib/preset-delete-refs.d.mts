/** A band or role pin the delete removes with the row. */
export type PresetDeleteCascadingRef = string;

export type PresetDeleteImpact = {
  cascading: string[];
  isDefault: boolean;
};

export type PresetDeleteAssignments = {
  bands?: Array<{ band: string; presetId: string | null } | null>;
  generationPreset?: { id: string } | null;
  reliablePreset?: { id: string } | null;
  reviewerPreset?: { id: string } | null;
  isDefault?: boolean;
};

/**
 * Where a preset is referenced, split by what the delete does about it.
 *
 * `cascading` names assignments the delete removes with the row; `isDefault`
 * is separate because the server refuses that delete instead of cascading it.
 */
export declare function describePresetDeleteImpact(
  presetId: string,
  assignments?: PresetDeleteAssignments,
): PresetDeleteImpact;

/**
 * The confirm dialog's description for deleting a preset: what goes with it,
 * what refuses it, and the one reference the dialog cannot see (card
 * assignments, decided by the server after confirm).
 */
export declare function presetDeleteDescription(
  presetName: string,
  impact: PresetDeleteImpact,
): string;
