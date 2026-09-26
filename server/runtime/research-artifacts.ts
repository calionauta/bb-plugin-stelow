import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isPublishableArtifactContent, parseArtifactManifest, resolveArtifactPath } from "../../lib/artifact-manifest.mjs";
import { contractForStrategy } from "../../lib/artifact-contracts.mjs";
import { validateExplore, validateSubstep, validateVariant } from "../../lib/artifact-validation.mjs";
import { evidenceStatus } from "../../lib/research-evidence.mjs";
import {
  exploreArtifactFile,
  findInvalidRounds,
  findInvalidSubsteps,
  isValidExploreContent,
  isValidRoundContent,
  researchRoundMirrorsIndex,
  substepQuality,
} from "../../lib/research-artifacts.mjs";
import { expectedSubsteps, missingSubsteps, researchStrategyById } from "../../lib/research-strategies.mjs";
import { parseRoundPath, substepPathsForRound } from "../../lib/research-rounds.mjs";
import { isResearchReadyForReview, researchReadyFingerprint } from "../../lib/research-ready.mjs";
import type { WorkerCard } from "../workers-types.js";

type CardWorkspace = { path: string; hostId: string | null };
type RoundHistory = Array<{ id: string; at: string; file: string }>;
type ResearchDeps = {
  bb: BbPluginApi;
  cardWorkspace: (card: WorkerCard) => Promise<CardWorkspace | null>;
  workflowStateDir: (rootPath: string, workflowId: string, dirHash: string) => Promise<string | null>;
  strategyRounds: (card: Pick<WorkerCard, "research_strategies" | "research_strategy">) => RoundHistory;
  joinPath: (root: string, relative: string) => string;
  workspaceRelative: (rootPath: string, path: string) => string | null;
  errors: { workspaceUnavailable: string };
};
type RoundFile = {
  display: string;
  path: string;
  absolutePath: string;
  hostId: string;
  generatedAt: string;
};
type Round = {
  n: number;
  strategyId: string;
  label: string;
  emoji: string;
  at: string;
  status: "ready" | "pending" | "missing";
  missing: string[];
  substeps: Array<{ slug: string; status: "ready" | "missing" | "invalid" | "needs-depth" }>;
  files: RoundFile[];
};
type SubstepRow = { n: number; label: string; slug: string; path: string };
export type ResearchReadiness = {
  ready: boolean;
  fingerprint: string | null;
  evidence: "verified" | "hypothesis-only";
  invalid: Array<{ n: number; label: string; slug?: string; reason?: string; detail?: string }>;
};

function fileTimestamp(file: { modifiedAtMs?: unknown } | null, fallback: string): string {
  const modifiedAtMs = file?.modifiedAtMs;
  return typeof modifiedAtMs === "number" && Number.isFinite(modifiedAtMs) && modifiedAtMs > 0
    ? new Date(modifiedAtMs).toISOString()
    : fallback;
}

function seedRounds(history: RoundHistory): Round[] {
  return history.map((entry, index) => {
    const meta = researchStrategyById(entry.id);
    return {
      n: index + 1,
      strategyId: entry.id,
      label: meta?.label ?? entry.id,
      emoji: meta?.emoji ?? "",
      at: entry.at,
      status: "missing" as const,
      missing: [],
      substeps: [],
      files: [],
    };
  });
}

async function readResearchText(
  deps: ResearchDeps,
  path: string,
): Promise<string | null> {
  return deps.bb.sdk.files.read({ path })
    .then((file) => (typeof file.content === "string" ? file.content : null))
    .catch(() => null);
}

async function addManifestSubsteps(
  deps: ResearchDeps,
  rounds: Round[],
  history: RoundHistory,
  workspacePath: string,
  stateDir: string,
  hostId: string,
  contents: Map<number, Array<{ slug: string; content: string | null }>>,
): Promise<void> {
  const stateBlob = await readResearchText(deps, deps.joinPath(stateDir, "state.md"));
  const manifest = stateBlob
    ? parseArtifactManifest(stateBlob).filter((fields) => fields.stage === "research" && typeof fields.path === "string")
    : [];
  for (const round of rounds) {
    const primary = history[round.n - 1];
    const stamp = parseRoundPath(primary.file, round.strategyId)?.stamp;
    if (!stamp) continue;
    for (const fields of manifest) {
      if (!fields.path || fields.path === primary.file) continue;
      const parsed = parseRoundPath(fields.path, round.strategyId);
      if (!parsed || parsed.roundNo !== round.n || parsed.stamp !== stamp) continue;
      const full = resolveArtifactPath(workspacePath, fields.path);
      if (!full) continue;
      const artifact = await deps.bb.sdk.files.read({ path: full }).catch(() => null);
      if (!artifact || !isPublishableArtifactContent(artifact.content)) continue;
      round.files.push({
        display: fields.label ?? full.split("/").pop()!,
        path: fields.path,
        absolutePath: full,
        hostId,
        generatedAt: fileTimestamp(artifact, round.at),
      });
      if (parsed.subskill && typeof artifact.content === "string") {
        const list = contents.get(round.n) ?? [];
        list.push({ slug: parsed.subskill, content: artifact.content });
        contents.set(round.n, list);
      }
    }
    round.files.sort((a, b) => (a.display < b.display ? -1 : 1));
  }
}

function addPrimaryRoundFile(
  round: Round,
  historyEntry: RoundHistory[number],
  file: { content: unknown; modifiedAtMs?: unknown } | null,
  full: string,
  hostId: string,
): void {
  round.files.unshift({
    display: `Round ${round.n} — ${round.label}`,
    path: historyEntry.file,
    absolutePath: full,
    hostId,
    generatedAt: fileTimestamp(file, round.at),
  });
}

async function finalizeRound(
  deps: ResearchDeps,
  round: Round,
  historyEntry: RoundHistory[number],
  workspacePath: string | null,
  hostId: string | null,
  indexBlob: string | null,
  live: boolean,
  isLast: boolean,
): Promise<void> {
  const present = round.files
    .map((file) => parseRoundPath(file.path, round.strategyId)?.subskill)
    .filter((slug): slug is string => typeof slug === "string");
  round.missing = missingSubsteps(round.strategyId, present);
  const full = workspacePath ? resolveArtifactPath(workspacePath, historyEntry.file) : null;
  if (!full || !hostId) {
    round.status = isLast && live ? "pending" : "missing";
    return;
  }
  const artifact = await deps.bb.sdk.files.read({ path: full }).catch(() => null);
  const content = artifact?.content ?? null;
  if (isValidRoundContent(content, indexBlob)) {
    round.status = "ready";
    addPrimaryRoundFile(round, historyEntry, artifact, full, hostId);
    return;
  }
  round.status = isLast && live ? "pending" : "missing";
  if (round.status === "pending" && isPublishableArtifactContent(content) && !researchRoundMirrorsIndex(content, indexBlob)) {
    addPrimaryRoundFile(round, historyEntry, artifact, full, hostId);
  }
}

async function researchRoundFiles(
  deps: ResearchDeps,
  workspacePath: string | null,
  hostId: string | null,
  stateDir: string | null,
  history: RoundHistory,
  live: boolean,
): Promise<{ rounds: Round[] }> {
  const rounds = seedRounds(history);
  const substepContents = new Map<number, Array<{ slug: string; content: string | null }>>();
  if (workspacePath && stateDir && hostId) {
    await addManifestSubsteps(deps, rounds, history, workspacePath, stateDir, hostId, substepContents)
      .catch(() => undefined);
  }
  const indexBlob = rounds.length > 0 && stateDir
    ? await readResearchText(deps, deps.joinPath(stateDir, "research-index.md"))
    : null;
  for (const round of rounds) {
    const primary = history[round.n - 1];
    round.substeps = substepQuality(
      expectedSubsteps(round.strategyId),
      substepContents.get(round.n) ?? [],
      indexBlob,
      (slug, content) => validateSubstep(slug, content).failures.map((failure) => failure.detail),
    );
    await finalizeRound(
      deps,
      round,
      primary,
      workspacePath,
      hostId,
      indexBlob,
      live,
      round.n === rounds.length,
    );
  }
  return { rounds: rounds.reverse() };
}

async function researchState(deps: ResearchDeps, card: WorkerCard) {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path || !card.dir_hash) return null;
  const stateDir = await deps.workflowStateDir(workspace.path, card.id, card.dir_hash).catch(() => null);
  return stateDir ? { workspace, stateDir } : null;
}

function contentReader(
  deps: ResearchDeps,
  workspacePath: string,
  cache: Map<string, string | null>,
) {
  return async (relativePath: string): Promise<string | null> => {
    if (cache.has(relativePath)) return cache.get(relativePath) ?? null;
    const full = resolveArtifactPath(workspacePath, relativePath);
    const content = full ? await readResearchText(deps, full) : null;
    cache.set(relativePath, content);
    return content;
  };
}

function invalidPrimaryRounds(
  history: RoundHistory,
  cache: Map<string, string | null>,
  indexBlob: string | null,
) {
  return findInvalidRounds(
    history,
    (path) => cache.get(path) ?? null,
    indexBlob,
    (id) => researchStrategyById(id)?.label ?? null,
    (strategyId, content) => validateVariant(content, contractForStrategy(strategyId)).failures.map((failure) => failure.detail),
  );
}

async function manifestSubsteps(
  deps: ResearchDeps,
  stateDir: string,
  history: RoundHistory,
): Promise<SubstepRow[]> {
  const stateBlob = await readResearchText(deps, deps.joinPath(stateDir, "state.md"));
  const manifestPaths = stateBlob
    ? parseArtifactManifest(stateBlob)
      .filter((fields) => fields.stage === "research" && typeof fields.path === "string")
      .map((fields) => fields.path as string)
    : [];
  const substeps: SubstepRow[] = [];
  history.forEach((entry, index) => {
    const n = index + 1;
    const label = researchStrategyById(entry.id)?.label ?? entry.id;
    for (const path of substepPathsForRound(manifestPaths, entry.id, entry.file)) {
      const slug = parseRoundPath(path, entry.id)?.subskill ?? path.split("/").pop() ?? path;
      substeps.push({ n, label, slug, path });
    }
  });
  return substeps;
}

async function researchRoundIntegrity(deps: ResearchDeps, card: WorkerCard) {
  const state = await researchState(deps, card);
  if (!state) return [];
  const history = deps.strategyRounds(card);
  if (history.length === 0) return [];
  const indexBlob = await readResearchText(deps, deps.joinPath(state.stateDir, "research-index.md"));
  const cache = new Map<string, string | null>();
  const readContent = contentReader(deps, state.workspace.path, cache);
  for (const entry of history) await readContent(entry.file);
  const invalid = invalidPrimaryRounds(history, cache, indexBlob);
  const substeps = await manifestSubsteps(deps, state.stateDir, history);
  for (const substep of substeps) await readContent(substep.path);
  invalid.push(...findInvalidSubsteps(
    substeps,
    (path) => cache.get(path) ?? null,
    indexBlob,
    (slug, content) => validateSubstep(slug, content).failures.map((failure) => failure.detail),
  ));
  return invalid;
}

async function readResearchIndex(deps: ResearchDeps, card: WorkerCard) {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return { ok: false as const, error: deps.errors.workspaceUnavailable };
  if (!card.dir_hash) return { ok: false as const, error: "No workflow state for this research yet." };
  const stateDir = await deps.workflowStateDir(workspace.path, card.id, card.dir_hash).catch(() => null);
  if (!stateDir) return { ok: false as const, error: "No workflow state for this research yet." };
  const absolute = deps.joinPath(stateDir, "research-index.md");
  const content = await readResearchText(deps, absolute);
  if (content === null) return { ok: false as const, error: "Research results are still being prepared." };
  return {
    ok: true as const,
    content,
    absolute,
    display: deps.workspaceRelative(workspace.path, absolute) ?? "research-index.md",
  };
}

async function researchReadiness(deps: ResearchDeps, card: WorkerCard): Promise<ResearchReadiness> {
  if (card.kind !== "research") return { ready: false, fingerprint: null, evidence: "verified", invalid: [] };
  const index = await readResearchIndex(deps, card).catch(() => null);
  if (!index || index.ok !== true) return { ready: false, fingerprint: null, evidence: "verified", invalid: [] };
  const evidence = evidenceStatus(index.content);
  if (!isResearchReadyForReview(index.content)) return { ready: false, fingerprint: null, evidence, invalid: [] };
  const invalid = await researchRoundIntegrity(deps, card).catch(() => []);
  if (invalid.length > 0) return { ready: false, fingerprint: null, evidence, invalid };
  return { ready: true, fingerprint: researchReadyFingerprint(index.content), evidence, invalid: [] };
}

function shortFingerprint(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

async function exploreArtifact(deps: ResearchDeps, card: WorkerCard) {
  const state = await researchState(deps, card);
  if (!state || !card.explore_stage) {
    return { ready: false, fingerprint: null, failures: [] as string[] };
  }
  const full = deps.joinPath(state.stateDir, exploreArtifactFile(card.explore_stage));
  const content = await readResearchText(deps, full);
  if (!isValidExploreContent(content)) return { ready: false, fingerprint: null, failures: [] as string[] };
  const failures = validateExplore(card.explore_stage, content).failures.map((failure) => failure.detail).slice(0, 3);
  if (failures.length > 0) return { ready: false, fingerprint: null, failures };
  return { ready: true, fingerprint: shortFingerprint(content as string), failures: [] as string[] };
}

export function createResearchArtifactRuntime(deps: ResearchDeps) {
  return {
    researchRoundFiles: (
      workspacePath: string | null,
      hostId: string | null,
      stateDir: string | null,
      history: RoundHistory,
      live: boolean,
    ) => researchRoundFiles(deps, workspacePath, hostId, stateDir, history, live),
    researchRoundIntegrity: (card: WorkerCard) => researchRoundIntegrity(deps, card),
    readResearchIndex: (card: WorkerCard) => readResearchIndex(deps, card),
    researchReadiness: (card: WorkerCard) => researchReadiness(deps, card),
    exploreArtifact: (card: WorkerCard) => exploreArtifact(deps, card),
    shortFingerprint,
  };
}

export type ResearchArtifactRuntime = ReturnType<typeof createResearchArtifactRuntime>;
