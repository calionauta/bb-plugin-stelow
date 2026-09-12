function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * Workflow names are presentation only. A card owns state through its immutable
 * workflow id (the card id for panel-created work), never through its name.
 */
export function workflowEntryForOwner(workflows, workflowId, dirHash = null) {
  if (!Array.isArray(workflows) || !workflowId) return null;
  return workflows.find((raw) => {
    const entry = record(raw);
    return text(entry.workflowId) === workflowId
      && (!dirHash || text(entry.dirHash) === dirHash);
  }) ?? null;
}

export function workflowStateRelativeDir(raw) {
  const entry = record(raw);
  const created = text(entry.created).slice(0, 10);
  const dirHash = text(entry.dirHash);
  return created && dirHash ? `.stelow/${created}/${dirHash}` : null;
}

/**
 * Stable owner for work a human seeds by name — there is no card to own it.
 * Derived from the name so seeding the same workflow twice reuses one entry
 * (and one directory) instead of accumulating look-alike rows.
 *
 * `sw_` reads as "a stelow workflow", in the same shape as every other id the
 * host mints (`card_…`, `proj_…`, `thr_…`). An owner a card mints is that
 * card's id, so a seeded workflow can never be mistaken for — or collide with
 * — card-owned state.
 */
export function workflowIdForName(name) {
  const slug = text(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `sw_${slug || "seed"}`;
}

// Directory identity derives from its owner instead of a second unrelated
// random value. A reseed intentionally receives a new generation.
export function workflowDirHash(workflowId, fresh = false, timestamp = Date.now()) {
  const owner = text(workflowId).replace(/[^A-Za-z0-9_-]/g, "-");
  if (!owner) throw new Error("workflowId is required");
  return fresh ? `pw-${owner}-${timestamp.toString(36)}` : `pw-${owner}`;
}

export function stateWorkflowId(stateBlob) {
  if (typeof stateBlob !== "string") return "";
  const value = stateBlob.match(/^workflow_id:\s*(.+?)\s*$/m)?.[1] ?? "";
  return value.trim().replace(/^["']|["']$/g, "");
}

export function ownsWorkflowState(stateBlob, workflowId) {
  return Boolean(workflowId) && stateWorkflowId(stateBlob) === workflowId;
}

/** Replace only the matching immutable owner; same-name workflows coexist. */
export function upsertWorkflowEntry(workflows, nextEntry) {
  const entries = Array.isArray(workflows) ? [...workflows] : [];
  const workflowId = text(record(nextEntry).workflowId);
  if (!workflowId) throw new Error("workflowId is required");
  const index = entries.findIndex((entry) => text(record(entry).workflowId) === workflowId);
  if (index === -1) return [...entries, nextEntry];
  // `created` pins the date segment of the state path
  // (.stelow/<created>/<dirHash>): keep the workflow's first one, so re-seeding
  // an owner never moves its state directory or strands the old one.
  const created = text(record(entries[index]).created) || text(record(nextEntry).created);
  entries[index] = { ...record(entries[index]), ...record(nextEntry), created };
  return entries;
}
