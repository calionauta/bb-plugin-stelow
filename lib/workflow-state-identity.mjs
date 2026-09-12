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
  entries[index] = { ...record(entries[index]), ...record(nextEntry) };
  return entries;
}
