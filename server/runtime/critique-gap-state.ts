import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { contractForBuildArtifact } from "../../lib/artifact-contracts.mjs";
import { parseArtifactManifest, resolveArtifactPath } from "../../lib/artifact-manifest.mjs";
import { escalatedGaps, summarizeGaps, validateGapRegistry } from "../../lib/gap-registry.mjs";
import type { WorkerCard } from "../workers-types.js";

type Workspace = { path: string; hostId: string | null };
type GapTotals = { total: number; fixed: number; documented: number; escalated: number };
type AuditGapScope = { id: string; name: string; status: string; gap: string | null };
export type CritiqueGapState = {
  matched: boolean;
  failures: string[];
  totals: GapTotals;
  escalated: Array<{ description: string }>;
  auditGapScopes: AuditGapScope[];
  critiqueText: string;
};

type CritiqueDeps = {
  bb: BbPluginApi;
  cardWorkspace: (card: WorkerCard) => Promise<Workspace | null>;
  workflowStateDir: (card: WorkerCard, rootPath: string) => Promise<string | null>;
  loadCardScopes: (rootPath: string, cardId: string) => Array<Record<string, unknown>>;
};

type CritiqueAccumulator = {
  failures: string[];
  totals: GapTotals;
  escalated: Array<{ description: string }>;
  critiqueTexts: string[];
};

function emptyGapState(): CritiqueGapState {
  return {
    matched: false,
    failures: [],
    totals: { total: 0, fixed: 0, documented: 0, escalated: 0 },
    escalated: [],
    auditGapScopes: [],
    critiqueText: "",
  };
}

function emptyAccumulator(): CritiqueAccumulator {
  return {
    failures: [],
    totals: { total: 0, fixed: 0, documented: 0, escalated: 0 },
    escalated: [],
    critiqueTexts: [],
  };
}

function addGapTotals(target: GapTotals, summary: ReturnType<typeof summarizeGaps>) {
  if (!summary.found) return;
  target.total += summary.total;
  target.fixed += summary.fixed;
  target.documented += summary.documented;
  target.escalated += summary.escalated;
}

function addEscalatedGaps(target: CritiqueAccumulator, content: string) {
  for (const gap of escalatedGaps(content)) {
    const description = String(gap.description ?? "").trim();
    if (description && !target.escalated.some((entry) => entry.description === description)) {
      target.escalated.push({ description });
    }
  }
}

async function readArtifact(
  deps: CritiqueDeps,
  workspacePath: string,
  relativePath: string,
): Promise<string | null> {
  const full = resolveArtifactPath(workspacePath, relativePath);
  if (!full) return null;
  const file = await deps.bb.sdk.files.read({ path: full }).catch(() => null);
  return typeof file?.content === "string" ? file.content : null;
}

async function collectCritique(
  deps: CritiqueDeps,
  state: string,
  workspacePath: string,
): Promise<CritiqueAccumulator | null> {
  const result = emptyAccumulator();
  let matched = false;
  for (const fields of parseArtifactManifest(state)) {
    if (typeof fields.path !== "string" || !fields.path.endsWith(".md")) continue;
    const content = await readArtifact(deps, workspacePath, fields.path);
    if (typeof content !== "string" || !content.trim()) continue;
    if (contractForBuildArtifact(fields.path, content)?.id !== "execution-critique") continue;
    matched = true;
    result.critiqueTexts.push(content);
    for (const failure of validateGapRegistry(content)) {
      result.failures.push(`FAIL ${fields.label ?? fields.path}: ${failure.detail}`);
    }
    addGapTotals(result.totals, summarizeGaps(content));
    addEscalatedGaps(result, content);
  }
  return matched ? result : null;
}

function auditGapScopes(
  deps: CritiqueDeps,
  workspacePath: string,
  cardId: string,
): AuditGapScope[] {
  try {
    return deps.loadCardScopes(workspacePath, cardId).flatMap((scope) => {
      if (scope.source !== "audit-gap") return [];
      return [{
        id: String(scope.id ?? ""),
        name: String(scope.name ?? ""),
        status: String(scope.status ?? ""),
        gap: typeof scope.gap === "string" ? scope.gap : null,
      }];
    });
  } catch {
    return [];
  }
}

export function createCritiqueGapState(deps: CritiqueDeps) {
  return async function critiqueGapState(card: WorkerCard): Promise<CritiqueGapState> {
    const workspace = await deps.cardWorkspace(card).catch(() => null);
    if (!workspace?.path || !card.dir_hash) return emptyGapState();
    const stateDir = await deps.workflowStateDir(card, workspace.path).catch(() => null);
    if (!stateDir) return emptyGapState();
    const stateFile = await deps.bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .catch(() => null);
    const state = typeof stateFile?.content === "string" ? stateFile.content : null;
    if (!state) return emptyGapState();
    const critique = await collectCritique(deps, state, workspace.path);
    if (!critique) return emptyGapState();
    return {
      matched: true,
      failures: critique.failures,
      totals: critique.totals,
      escalated: critique.escalated,
      auditGapScopes: auditGapScopes(deps, workspace.path, card.id),
      critiqueText: critique.critiqueTexts.join("\n\n"),
    };
  };
}
