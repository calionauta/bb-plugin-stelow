/**
 * What a preset delete touches besides the preset row, as data the confirm
 * dialog can name.
 *
 * A delete cascades out of `presets` into `stage_presets` and the three
 * singleton role tables (`ON DELETE CASCADE`), while a preset assigned to
 * cards — or the board default — is refused by the server instead. The dialog
 * cannot see card assignments (there is no usage-count RPC), so those stay a
 * post-confirm server message; but bands, roles and default-ness are already
 * loaded by the manager shell, so the confirm names them before the click.
 *
 * Pure, so the wording is asserted by execution rather than read out of a
 * component: the shell stays thin and the copy lives where a node test can
 * run it.
 */

/**
 * Where a preset is referenced, split by what the delete does about it.
 *
 * `cascading` names assignments the delete removes with the row; `isDefault`
 * is separate because the server refuses that delete instead of cascading it.
 */
export function describePresetDeleteImpact(presetId, assignments = {}) {
  const { bands = [], generationPreset = null, reliablePreset = null, reviewerPreset = null } = assignments;
  const cascading = [];
  for (const band of bands) {
    if (band && band.presetId === presetId) cascading.push(`band "${band.band}"`);
  }
  if (generationPreset && generationPreset.id === presetId) cascading.push("draft-generation preset");
  if (reliablePreset && reliablePreset.id === presetId) cascading.push("reliable-tier preset");
  if (reviewerPreset && reviewerPreset.id === presetId) cascading.push("reviewer preset");
  return { cascading, isDefault: assignments.isDefault === true };
}

/**
 * The confirm dialog's description for deleting a preset: what goes with it,
 * what refuses it, and the one reference the dialog cannot see (card
 * assignments, decided by the server after confirm).
 */
export function presetDeleteDescription(presetName, impact) {
  const { cascading, isDefault } = impact;
  const parts = [`Removes the "${presetName}" agent preset.`];
  if (isDefault) {
    parts.push("It is the board default, so the delete is refused until another preset is set as default.");
  } else if (cascading.length > 0) {
    parts.push(`It is currently the ${joinRefs(cascading)} — those assignments are removed with it.`);
  }
  parts.push("Cards already using it must be unassigned first, or the delete is refused and nothing is removed.");
  return parts.join(" ");
}

function joinRefs(refs) {
  if (refs.length === 1) return refs[0];
  return `${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}`;
}
