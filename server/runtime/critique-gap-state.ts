import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { contractForBuildArtifact } from "../../lib/artifact-contracts.mjs";
import { parseArtifactManifest, resolveArtifactPath } from "../../lib/artifact-manifest.mjs";
import { escalatedGaps, parseGapFrontmatter, registryGaps, summarizeGaps, validateGapRegistry } from "../../lib/gap-registry.mjs";
import type { GapEvidence } from "../../lib/gap-registry.mjs";
import { addGapTotals as addTotals, emptyGapTotals } from "../../lib/metrics-format.mjs";
import type { GapTotals } from "../../lib/metrics-format.mjs";
import type { WorkerCard } from "../workers-types.js";

type Workspace = { path: string; hostId: string | null };
type AuditGapScope = { id: string; name: string; status: string; gap: string | null };
export type CritiqueGapState = {
  matched: boolean;
  failures: string[];
  totals: GapTotals;
  /** Every finding the registry named, with its disposition. The card lists
   * these; `escalated` is the subset the rework loop consumes. `evidence`
   * carries the cited measurements when the row has an `evidence:` block,
   * null when the finding is unmeasured (fail-open, never a failure).
   * `expires`/`owner` ride documented debt rows; gates decide what a past
   * date means, this state only carries it. */
  gaps: Array<{ description: string; resolution: string; evidence: GapEvidence | null; expires: string | null; owner: string | null }>;
  escalated: Array<{ description: string; evidence: GapEvidence | null }>;
  auditGapScopes: AuditGapScope[];
  critiqueText: string;
  /** One entry per registered critique artifact, oldest first. The round
   * boundary is what makes rework measurable: `gaps` and `escalated` dedupe
   * across rounds on purpose, so a finding fixed in round 1 and re-opened in
   * round 3 is one row there and a rework event here. Empty when no critique
   * report is individually readable, which the metric treats as "not
   * measured" rather than "nothing reworked". */
  critiqueRounds: Array<Array<{ description: string; resolution: string }>>;
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
  gaps: Array<{ description: string; resolution: string; evidence: GapEvidence | null; expires: string | null; owner: string | null }>;
  escalated: Array<{ description: string; evidence: GapEvidence | null }>;
  critiqueTexts: string[];
  /** Kept per round rather than only as text: the joined form cannot say which
   * finding belongs to which pass, and that is the whole of a rework metric. */
  rounds: Array<Array<{ description: string; resolution: string }>>;
};

function emptyGapState(): CritiqueGapState {
  return {
    matched: false,
    failures: [],
    totals: emptyGapTotals(),
    gaps: [],
    escalated: [],
    auditGapScopes: [],
    critiqueText: "",
    critiqueRounds: [],
  };
}

function emptyAccumulator(): CritiqueAccumulator {
  return {
    failures: [],
    totals: emptyGapTotals(),
    gaps: [],
    escalated: [],
    critiqueTexts: [],
    rounds: [],
  };
}

function addEscalatedGaps(target: CritiqueAccumulator, content: string) {
  const evidenceByDescription = evidenceMap(content);
  for (const gap of escalatedGaps(content)) {
    const description = String(gap.description ?? "").trim();
    if (description && !target.escalated.some((entry) => entry.description === description)) {
      target.escalated.push({ description, evidence: evidenceByDescription.get(description) ?? null });
    }
  }
}

// Every finding, deduplicated across the critique rounds a card accumulated.
// A gap re-audited in a later round is the same finding, not a second one.
function addRegistryGaps(target: CritiqueAccumulator, content: string) {
  const evidenceByDescription = evidenceMap(content);
  const debtByDescription = debtMap(content);
  for (const gap of registryGaps(content)) {
    if (!target.gaps.some((entry) => entry.description === gap.description)) {
      target.gaps.push({
        description: gap.description,
        resolution: gap.resolution,
        evidence: evidenceByDescription.get(gap.description) ?? null,
        expires: debtByDescription.get(gap.description)?.expires ?? null,
        owner: debtByDescription.get(gap.description)?.owner ?? null,
      });
    }
  }
}

/** Measurements cited per finding, keyed by normalised description. The
 * registry rows above carry disposition only; this joins the evidence the
 * same frontmatter parsed, so unmeasured findings read null, never absent. */
function evidenceMap(content: string): Map<string, GapEvidence | null> {
  const map = new Map<string, GapEvidence | null>();
  for (const gap of parseGapFrontmatter(content).gaps) {
    const description = String(gap.description ?? "").trim();
    if (description && !map.has(description)) map.set(description, gap.evidence ?? null);
  }
  return map;
}

/** Debt metadata per finding, keyed the same way. Raw strings, validated
 * downstream: a malformed date is a registry failure, not a silent null. */
function debtMap(content: string): Map<string, { expires: string | null; owner: string | null }> {
  const map = new Map<string, { expires: string | null; owner: string | null }>();
  for (const gap of parseGapFrontmatter(content).gaps) {
    const description = String(gap.description ?? "").trim();
    if (description && !map.has(description)) {
      map.set(description, {
        expires: typeof gap.expires === "string" && gap.expires.trim() !== "" ? gap.expires.trim() : null,
        owner: typeof gap.owner === "string" && gap.owner.trim() !== "" ? gap.owner.trim() : null,
      });
    }
  }
  return map;
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
    result.rounds.push(registryGaps(content));
    for (const failure of validateGapRegistry(content)) {
      result.failures.push(`FAIL ${fields.label ?? fields.path}: ${failure.detail}`);
    }
    addTotals(result.totals, summarizeGaps(content));
    addRegistryGaps(result, content);
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
      gaps: critique.gaps,
      escalated: critique.escalated,
      auditGapScopes: auditGapScopes(deps, workspace.path, card.id),
      critiqueText: critique.critiqueTexts.join("\n\n"),
      critiqueRounds: critique.rounds,
    };
  };
}
