/**
 * The decision receipt store. One JSON file per card state dir
 * (`decision-receipts.json`): the worker proposes through `bb stelow decide`,
 * the host appends. File I/O arrives injected (`files: read/write`), so the
 * store is testable without a checkout.
 *
 * Failure discipline, and it is asymmetric on purpose: reads stay best-effort
 * (serving must never block execution), while writes fail closed — a
 * present-but-corrupt file refuses the write instead of overwriting evidence
 * the host cannot read. A missing file is empty, never corrupt.
 */
import {
  DECISION_RECEIPTS_FILE,
  parseReceiptStore,
  serializeReceiptFile,
  validateDecisionReceipt,
} from "../../lib/decision-receipts.mjs";
import { parseChallenge } from "../../lib/decision-receipts.mjs";

export type FilesAdapter = {
  read: (args: { path: string }) => Promise<{ content: string }>;
  write: (args: { path: string; rootPath: string; expectedSha256: null; content: string }) => Promise<unknown>;
};

export type DecisionReceipt = Record<string, unknown> & { id: string };
export type DecisionChallenge = Record<string, unknown> & { id: string; receiptId: string };
export type StoredDecisions = { receipts: DecisionReceipt[]; challenges: DecisionChallenge[]; corrupt: boolean };

function filePath(stateDir: string): string {
  return `${stateDir.replace(/\/$/, "")}/${DECISION_RECEIPTS_FILE}`;
}

async function readStore(files: FilesAdapter, stateDir: string): Promise<StoredDecisions> {
  try {
    const file = await files.read({ path: filePath(stateDir) });
    const parsed = parseReceiptStore(file?.content);
    return {
      receipts: parsed.receipts as DecisionReceipt[],
      challenges: parsed.challenges as DecisionChallenge[],
      corrupt: parsed.corrupt,
    };
  } catch {
    return { receipts: [], challenges: [], corrupt: false };
  }
}

/** All parseable receipts; corrupt files read as empty, never throw. */
export async function loadDecisionReceipts(files: FilesAdapter, stateDir: string): Promise<DecisionReceipt[]> {
  return (await readStore(files, stateDir)).receipts;
}

/** The whole registry (receipts + challenges) plus the corruption verdict. */
export async function loadDecisions(files: FilesAdapter, stateDir: string): Promise<StoredDecisions> {
  return readStore(files, stateDir);
}

/** Append (or replace by id) and persist. Refuses invalid or unreadable stores. */
export async function saveDecisionReceipt(
  files: FilesAdapter,
  rootPath: string,
  stateDir: string,
  receipt: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const issues = validateDecisionReceipt(receipt);
  if (issues.length > 0) return { ok: false, error: `invalid decision receipt: ${issues.join("; ")}` };
  const current = await readStore(files, stateDir);
  if (current.corrupt) {
    return { ok: false, error: `refusing to write: ${DECISION_RECEIPTS_FILE} is present but unreadable` };
  }
  const next = [...current.receipts.filter((entry) => entry.id !== (receipt as DecisionReceipt).id), receipt as DecisionReceipt];
  await files.write({
    path: filePath(stateDir),
    rootPath,
    expectedSha256: null,
    content: serializeReceiptFile(next, current.challenges),
  });
  return { ok: true };
}

/** Append a challenge to the registry. Refuses invalid or unreadable stores. */
export async function saveChallenge(
  files: FilesAdapter,
  rootPath: string,
  stateDir: string,
  challenge: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!parseChallenge(challenge)) return { ok: false, error: "invalid decision challenge" };
  const current = await readStore(files, stateDir);
  if (current.corrupt) {
    return { ok: false, error: `refusing to write: ${DECISION_RECEIPTS_FILE} is present but unreadable` };
  }
  await files.write({
    path: filePath(stateDir),
    rootPath,
    expectedSha256: null,
    content: serializeReceiptFile(current.receipts, [...current.challenges, challenge as DecisionChallenge]),
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
  const current = await readStore(files, stateDir);
  if (current.corrupt) return;
  const next = current.receipts.map((entry) =>
    olderIds.includes(entry.id) && !entry.supersededBy ? { ...entry, supersededBy: byId } : entry,
  );
  await files.write({
    path: filePath(stateDir),
    rootPath,
    expectedSha256: null,
    content: serializeReceiptFile(next, current.challenges),
  });
}
