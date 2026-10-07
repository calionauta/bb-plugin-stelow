/**
 * The decision receipt store. One JSON file per card state dir
 * (`decision-receipts.json`): the worker proposes through `bb stelow decide`,
 * the host appends. File I/O arrives injected (`files: read/write`), so the
 * store is testable without a checkout and every failure degrades to "no
 * receipts" or a named refusal — the store never breaks a caller that only
 * wanted to read.
 */
import {
  DECISION_RECEIPTS_FILE,
  parseReceiptFile,
  serializeReceiptFile,
  validateDecisionReceipt,
} from "../../lib/decision-receipts.mjs";

export type FilesAdapter = {
  read: (args: { path: string }) => Promise<{ content: string }>;
  write: (args: { path: string; rootPath: string; expectedSha256: null; content: string }) => Promise<unknown>;
};

export type DecisionReceipt = Record<string, unknown> & { id: string };

function filePath(stateDir: string): string {
  return `${stateDir.replace(/\/$/, "")}/${DECISION_RECEIPTS_FILE}`;
}

/** All parseable receipts; missing or corrupt files read as empty, never throw. */
export async function loadDecisionReceipts(files: FilesAdapter, stateDir: string): Promise<DecisionReceipt[]> {
  try {
    const file = await files.read({ path: filePath(stateDir) });
    return parseReceiptFile(file?.content) as DecisionReceipt[];
  } catch {
    return [];
  }
}

/** Append (or replace by id) and persist. Refuses invalid receipts with the reason. */
export async function saveDecisionReceipt(
  files: FilesAdapter,
  rootPath: string,
  stateDir: string,
  receipt: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const issues = validateDecisionReceipt(receipt);
  if (issues.length > 0) return { ok: false, error: `invalid decision receipt: ${issues.join("; ")}` };
  const current = await loadDecisionReceipts(files, stateDir);
  const next = [...current.filter((entry) => entry.id !== (receipt as DecisionReceipt).id), receipt as DecisionReceipt];
  await files.write({
    path: filePath(stateDir),
    rootPath,
    expectedSha256: null,
    content: serializeReceiptFile(next),
  });
  return { ok: true };
}

/** Mark receipts superseded by a new id (the chain write). Unknown ids are ignored. */
export async function markSuperseded(
  files: FilesAdapter,
  rootPath: string,
  stateDir: string,
  olderIds: string[],
  byId: string,
): Promise<void> {
  if (!Array.isArray(olderIds) || olderIds.length === 0) return;
  const current = await loadDecisionReceipts(files, stateDir);
  const next = current.map((entry) =>
    olderIds.includes(entry.id) && !entry.supersededBy ? { ...entry, supersededBy: byId } : entry,
  );
  await files.write({
    path: filePath(stateDir),
    rootPath,
    expectedSha256: null,
    content: serializeReceiptFile(next),
  });
}
