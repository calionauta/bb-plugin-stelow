/**
 * Workflow lineage for stelow.json (see upstream state-contract.md:
 * "stelow.json Worker Lineage"). Pure JSON surgery, no host dependency, so
 * it is unit-tested here; the server only handles file IO around it.
 *
 * Mirrors the plugin's card_threads ledger, but lives in the workflow's own
 * state: it survives plugin database loss, any host can read it, and the
 * worker itself can consult its predecessors for continuity.
 */

/**
 * File-level merge: parse, apply, serialize. Returns the new file content,
 * or null when nothing should be written (unparseable, unknown workflow).
 * Pure — the server handles IO and conflict retries around it.
 */
export function mergeLineageFile(existingContent, dirHash, entry) {
  if (typeof existingContent !== "string" || !existingContent.trim()) return null;
  let tracking;
  try {
    tracking = JSON.parse(existingContent);
  } catch {
    return null;
  }
  if (!applyLineage(tracking, dirHash, entry)) return null;
  return JSON.stringify(tracking, null, 2);
}

/**
 * Read-modify-write with conflict retry, against an injectable files object
 * (`{ read({path}), write({path, rootPath, expectedSha256, content}) }`).
 * `makeContent(existingContent|null)` returns the new content or null to
 * skip the write. A concurrent writer (e.g. the worker advancing stage)
 * surfaces as `outcome: "conflict"` — re-read, re-merge, retry instead of
 * blindly overwriting their change. Returns `{ written, attempts }`.
 */
export async function writeMergedFile(files, path, rootPath, makeContent, maxAttempts = 3) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    let existing = null;
    try {
      const file = await files.read({ path });
      existing = file != null && typeof file.content === "string" ? file.content : null;
    } catch {
      existing = null;
    }
    let next = null;
    try {
      next = makeContent(existing);
    } catch {
      return { written: false, attempts };
    }
    if (next === null) return { written: false, attempts };
    try {
      const result = await files.write({ path, rootPath, expectedSha256: null, content: next });
      if (!result || result.outcome !== "conflict") return { written: true, attempts };
    } catch {
      return { written: false, attempts };
    }
  }
  return { written: false, attempts };
}

export function applyLineage(tracking, dirHash, entry) {
  if (!tracking || typeof tracking !== "object" || Array.isArray(tracking)) return false;
  const workflows = tracking.workflows;
  if (!Array.isArray(workflows)) return false;
  const workflow = workflows.find((item) => item != null && typeof item === "object" && item.dirHash === dirHash);
  if (!workflow) return false;
  if (!Array.isArray(workflow.workers)) workflow.workers = [];
  const now = new Date().toISOString();
  for (const row of workflow.workers) {
    if (row != null && typeof row === "object" && row.ended_at == null) {
      row.ended_at = now;
      row.ended_reason = entry.endedReason;
    }
  }
  workflow.workers.push({
    thread_id: entry.threadId,
    preset: entry.presetId ?? null,
    started_at: now,
    ended_at: null,
    ended_reason: null,
  });
  return true;
}
