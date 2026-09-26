import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { contractForBuildArtifact, contractForStrategy } from "../../lib/artifact-contracts.mjs";
import { resolveArtifactPath } from "../../lib/artifact-manifest.mjs";
import { sealStatus, validateArtifact, validateExplore, validateSubstep, validateVariant } from "../../lib/artifact-validation.mjs";
import { parseRoundPath } from "../../lib/research-rounds.mjs";
import {
  exploreArtifactFile,
  isValidExploreContent,
  isValidRoundContent,
} from "../../lib/research-artifacts.mjs";
import { researchStrategyById } from "../../lib/research-strategies.mjs";
import { evidenceStatus } from "../../lib/research-evidence.mjs";
import { techniqueById } from "../../lib/stage-catalog.mjs";
import type { WorkerCard } from "../workers-types.js";

type ResearchIndex = { ok: boolean; content?: string } | null;
type ResearchRound = { id: string; file: string };
type SealInput = { cardId?: string | null; threadId?: string | null; path: string };
type SealResult = {
  status: "verified" | "hypothesis-only" | "needs-revision" | "unverified";
  failures: string[];
  evidence: string | null;
  label: string | null;
};
type SealMatch = Partial<SealResult> & { matched?: boolean };
type QualitySealDeps = {
  bb: BbPluginApi;
  getCard: (cardId: string) => WorkerCard | undefined;
  getCardByWorkerThread: (threadId: string) => WorkerCard | null | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string; hostId: string | null } | null>;
  strategyRounds: (card: WorkerCard) => ResearchRound[];
  readResearchIndex: (card: WorkerCard) => Promise<ResearchIndex>;
};

const UNVERIFIED: SealResult = {
  status: "unverified",
  failures: [],
  evidence: null,
  label: null,
};

function failuresFrom(result: { pass: boolean; failures: Array<{ detail: string }> }) {
  return result.pass ? [] : result.failures.map((failure) => failure.detail).slice(0, 3);
}

async function readArtifact(
  deps: QualitySealDeps,
  workspacePath: string,
  path: string,
): Promise<string | null> {
  const full = resolveArtifactPath(workspacePath, path);
  if (!full) return null;
  const file = await deps.bb.sdk.files.read({ path: full }).catch(() => null);
  return typeof file?.content === "string" && file.content.trim() ? file.content : null;
}

async function researchSeal(
  deps: QualitySealDeps,
  card: WorkerCard,
  path: string,
  content: string,
): Promise<SealMatch> {
  const history = deps.strategyRounds(card);
  const primary = history.find((entry) => entry.file === path);
  if (primary) {
    return {
      matched: true,
      label: researchStrategyById(primary.id)?.label ?? primary.id,
      failures: failuresFrom(validateVariant(content, contractForStrategy(primary.id))),
    };
  }
  const substep = history.flatMap((entry) => {
    const parsed = parseRoundPath(path, entry.id);
    return parsed?.subskill ? [{ entry, parsed }] : [];
  })[0];
  if (!substep) return { evidence: "verified" };
  const subskill = substep.parsed.subskill;
  if (!subskill) return { evidence: "verified" };
  const index = await deps.readResearchIndex(card).catch(() => null);
  const indexBlob = index?.ok && typeof index.content === "string" ? index.content : null;
  return {
    matched: true,
    label: `${researchStrategyById(substep.entry.id)?.label ?? substep.entry.id} — ${subskill}`,
    failures: isValidRoundContent(content, indexBlob)
      ? validateSubstep(subskill, content).failures.map((failure) => failure.detail).slice(0, 3)
      : ["missing, thin, or mirrors the index — rewrite it"],
  };
}

async function exploreSeal(
  card: WorkerCard,
  path: string,
  content: string,
): Promise<SealMatch> {
  const stage = card.explore_stage ?? "";
  if (!path.endsWith(exploreArtifactFile(stage))) {
    return {};
  }
  if (!isValidExploreContent(content)) {
    return { matched: true, label: techniqueById(stage)?.label ?? stage, failures: ["missing or thin — write the stage deliverable"] };
  }
  return {
    matched: true,
    label: techniqueById(stage)?.label ?? stage,
    failures: validateExplore(stage, content).failures.map((failure) => failure.detail).slice(0, 3),
  };
}

function buildSeal(result: SealResult): SealResult {
  if (!result.label) return UNVERIFIED;
  return {
    status: sealStatus(result.failures.length === 0 ? { pass: true } : { pass: false }, result.evidence ?? "verified"),
    failures: result.failures,
    evidence: result.evidence,
    label: result.label,
  };
}

function buildBuildSeal(path: string, content: string): SealMatch {
  const contract = contractForBuildArtifact(path, content);
  if (!contract) return {};
  return { matched: true, label: contract.id, failures: failuresFrom(validateArtifact(content, contract)) };
}

export function createQualitySeal(deps: QualitySealDeps) {
  return async function qualitySeal(input: SealInput): Promise<SealResult> {
    const card = (input.cardId ? deps.getCard(input.cardId) : null)
      ?? (input.threadId ? deps.getCardByWorkerThread(input.threadId) : null);
    if (!card) return UNVERIFIED;
    const workspace = await deps.cardWorkspace(card).catch(() => null);
    if (!workspace?.path) return UNVERIFIED;
    const content = await readArtifact(deps, workspace.path, input.path);
    if (!content) return UNVERIFIED;
    const partial = card.kind === "research"
      ? await researchSeal(deps, card, input.path, content)
      : card.kind === "explore"
        ? await exploreSeal(card, input.path, content)
        : buildBuildSeal(input.path, content);
    const result = { ...UNVERIFIED, ...partial } as SealResult;
    if (partial.matched && result.evidence === null) result.evidence = "verified";
    const index = card.kind === "research" ? await deps.readResearchIndex(card).catch(() => null) : null;
    if (index?.ok && typeof index.content === "string") result.evidence = evidenceStatus(index.content);
    return buildSeal(result);
  };
}

export { UNVERIFIED as unverifiedSeal };
