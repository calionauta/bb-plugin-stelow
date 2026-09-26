import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  assertBoundaryAnswerCurrent,
  validateHumanBoundary,
} from "../lib/interface-contrast.mjs";
import { validateScopeMap, type ScopeMap } from "../lib/scope-map.mjs";
import { parseCurrentShapeVersion } from "../lib/scope-xray.mjs";
import type { ExecutionRun } from "../lib/execution-run-ledger.mjs";
import type { WorkerCard } from "./workers-types.js";

export type BoundaryContract = NonNullable<ExecutionRun["boundaryContract"]>;
export type BoundaryVersions = {
  shapeVersion: string;
  scopeMapVersion: string | null;
};

type BoundaryPatch = {
  issues: string[];
  patch: {
    boundaryId: string;
    boundaryQuestion: string;
    boundaryContract: Record<string, unknown>;
  };
};

export function boundaryRunPatch(
  boundary: Record<string, unknown>,
  boundaryId: string,
): BoundaryPatch {
  const boundaryContract = { ...boundary, boundaryId, status: "open" };
  const issues = validateHumanBoundary(boundaryContract);
  return {
    issues,
    patch: {
      boundaryId,
      boundaryQuestion: String(
        boundary.question ?? "The native workflow needs a human decision.",
      ),
      boundaryContract,
    },
  };
}

export function boundaryAnswerError(
  contract: BoundaryContract | null,
  currentVersions: BoundaryVersions | null,
  answerText: string,
): string | null {
  if (!contract || !currentVersions) {
    return "The native boundary contract is missing; answer the current question before resuming.";
  }
  const answerRecord = { ...contract, status: "answered", answer: answerText };
  const issues = validateHumanBoundary(answerRecord);
  if (issues.length || !assertBoundaryAnswerCurrent(currentVersions, answerRecord)) {
    return "The native boundary contract is missing or no longer current; answer the current question before resuming.";
  }
  return null;
}

export async function readCurrentBoundaryVersions(
  bb: BbPluginApi,
  stateDir: string | null,
  fallback: BoundaryVersions,
): Promise<BoundaryVersions> {
  if (!stateDir) return fallback;
  const stateText = await bb.sdk.files.read({ path: join(stateDir, "state.md") })
    .then((file) => file.content)
    .catch(() => null);
  const parsedMap = await bb.sdk.files.read({ path: join(stateDir, "scope-map.json") })
    .then((file) => {
      try { return JSON.parse(file.content) as unknown; }
      catch { return null; }
    })
    .catch(() => null);
  const validMap = parsedMap && validateScopeMap(parsedMap).length === 0
    ? parsedMap as ScopeMap
    : null;
  return {
    shapeVersion: parseCurrentShapeVersion(stateText) ?? fallback.shapeVersion,
    scopeMapVersion: validMap?.shapeVersion ?? fallback.scopeMapVersion,
  };
}

type BoundaryReaderDeps = {
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
  stateDir: (card: WorkerCard, rootPath: string) => Promise<string | null>;
};

export function createBoundaryVersionReader(deps: BoundaryReaderDeps) {
  return async (run: ExecutionRun): Promise<BoundaryVersions | null> => {
    if (!run.boundaryContract) return null;
    const fallback: BoundaryVersions = {
      shapeVersion: run.boundaryContract.shapeVersion,
      scopeMapVersion: run.boundaryContract.scopeMapVersion,
    };
    const card = deps.getCard(run.cardId);
    const workspace = card ? await deps.cardWorkspace(card) : null;
    const stateDir = card?.dir_hash && workspace?.path
      ? await deps.stateDir(card, workspace.path).catch(() => null)
      : null;
    return readCurrentBoundaryVersions(deps.bb, stateDir, fallback);
  };
}
