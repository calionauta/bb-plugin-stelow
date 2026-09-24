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

type ResearchDeps = {
  bb: BbPluginApi;
  cardWorkspace: (card: WorkerCard) => Promise<CardWorkspace | null>;
  workflowStateDir: (rootPath: string, workflowId: string, dirHash: string) => Promise<string | null>;
  strategyRounds: (card: Pick<WorkerCard, "research_strategies" | "research_strategy">) => Array<{ id: string; at: string; file: string }>;
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

export type ResearchReadiness = {
  ready: boolean;
  fingerprint: string | null;
  evidence: "verified" | "hypothesis-only";
  invalid: Array<{ n: number; label: string; slug?: string; reason?: string; detail?: string }>;
};

export function createResearchArtifactRuntime(deps: ResearchDeps) {
  function fileTimestamp(file: { modifiedAtMs?: unknown } | null, fallback: string): string {
    const modifiedAtMs = file?.modifiedAtMs;
    return typeof modifiedAtMs === "number" && Number.isFinite(modifiedAtMs) && modifiedAtMs > 0
      ? new Date(modifiedAtMs).toISOString()
      : fallback;
  }

  async function researchRoundFiles(
    workspacePath: string | null,
    hostId: string | null,
    stateDir: string | null,
    history: Array<{ id: string; at: string; file: string }>,
    live: boolean,
  ): Promise<{ rounds: Round[] }> {
    const rounds: Round[] = history.map((entry, index) => {
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
    const substepContents = new Map<number, Array<{ slug: string; content: string | null }>>();
    if (workspacePath && stateDir) {
      try {
        const stateBlob = await deps.bb.sdk.files.read({ path: deps.joinPath(stateDir, "state.md") })
          .then((file) => file.content)
          .catch(() => null);
        const manifest = stateBlob
          ? parseArtifactManifest(stateBlob).filter((fields) => fields.stage === "research" && typeof fields.path === "string")
          : [];
        for (const round of rounds) {
          const primary = history[round.n - 1];
          const stamp = parseRoundPath(primary.file, round.strategyId)?.stamp;
          if (!stamp || !hostId) continue;
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
              const list = substepContents.get(round.n) ?? [];
              list.push({ slug: parsed.subskill, content: artifact.content });
              substepContents.set(round.n, list);
            }
          }
          round.files.sort((a, b) => (a.display < b.display ? -1 : 1));
        }
      } catch {
        // History-only rounds remain useful when the manifest cannot be read.
      }
    }

    const indexBlob = rounds.length > 0 && stateDir
      ? await deps.bb.sdk.files.read({ path: deps.joinPath(stateDir, "research-index.md") })
        .then((file) => (typeof file.content === "string" ? file.content : null))
        .catch(() => null)
      : null;
    for (const round of rounds) {
      const present = round.files
        .map((file) => parseRoundPath(file.path, round.strategyId)?.subskill)
        .filter((slug): slug is string => typeof slug === "string");
      round.missing = missingSubsteps(round.strategyId, present);
      round.substeps = substepQuality(
        expectedSubsteps(round.strategyId),
        substepContents.get(round.n) ?? [],
        indexBlob,
        (slug, content) => validateSubstep(slug, content).failures.map((failure) => failure.detail),
      );
      const full = workspacePath
        ? resolveArtifactPath(workspacePath, history[round.n - 1].file)
        : null;
      const primaryLabel = `Round ${round.n} — ${round.label}`;
      if (full && hostId) {
        const artifact = await deps.bb.sdk.files.read({ path: full }).catch(() => null);
        const content = artifact?.content ?? null;
        if (isValidRoundContent(content, indexBlob)) {
          round.status = "ready";
          round.files.unshift({
            display: primaryLabel,
            path: history[round.n - 1].file,
            absolutePath: full,
            hostId,
            generatedAt: fileTimestamp(artifact, round.at),
          });
        } else {
          round.status = round.n === rounds.length && live ? "pending" : "missing";
          if (round.status === "pending" && isPublishableArtifactContent(content) && !researchRoundMirrorsIndex(content, indexBlob)) {
            round.files.unshift({
              display: primaryLabel,
              path: history[round.n - 1].file,
              absolutePath: full,
              hostId,
              generatedAt: fileTimestamp(artifact, round.at),
            });
          }
        }
      } else {
        round.status = round.n === rounds.length && live ? "pending" : "missing";
      }
    }
    return { rounds: rounds.reverse() };
  }

  async function researchRoundIntegrity(card: WorkerCard) {
    const workspace = await deps.cardWorkspace(card);
    if (!workspace?.path || !card.dir_hash) return [];
    const stateDir = await deps.workflowStateDir(workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return [];
    const history = deps.strategyRounds(card);
    if (history.length === 0) return [];
    const indexBlob = await deps.bb.sdk.files.read({ path: deps.joinPath(stateDir, "research-index.md") })
      .then((file) => (typeof file.content === "string" ? file.content : null))
      .catch(() => null);
    const contents = new Map<string, string | null>();
    const readAndCache = async (relPath: string): Promise<string | null> => {
      if (contents.has(relPath)) return contents.get(relPath) ?? null;
      const full = resolveArtifactPath(workspace.path, relPath);
      const content = full
        ? await deps.bb.sdk.files.read({ path: full }).then((file) => file.content).catch(() => null)
        : null;
      contents.set(relPath, content);
      return content;
    };
    for (const entry of history) await readAndCache(entry.file);
    const invalid = findInvalidRounds(
      history,
      (path) => contents.get(path) ?? null,
      indexBlob,
      (id) => researchStrategyById(id)?.label ?? null,
      (strategyId, content) => validateVariant(content, contractForStrategy(strategyId)).failures.map((failure) => failure.detail),
    );
    const stateBlob = await deps.bb.sdk.files.read({ path: deps.joinPath(stateDir, "state.md") })
      .then((file) => file.content)
      .catch(() => null);
    const manifestPaths = stateBlob
      ? parseArtifactManifest(stateBlob)
        .filter((fields) => fields.stage === "research" && typeof fields.path === "string")
        .map((fields) => fields.path as string)
      : [];
    const substeps: Array<{ n: number; label: string; slug: string; path: string }> = [];
    history.forEach((entry, index) => {
      const n = index + 1;
      const label = researchStrategyById(entry.id)?.label ?? entry.id;
      for (const subPath of substepPathsForRound(manifestPaths, entry.id, entry.file)) {
        const slug = parseRoundPath(subPath, entry.id)?.subskill ?? subPath.split("/").pop() ?? subPath;
        substeps.push({ n, label, slug, path: subPath });
      }
    });
    for (const substep of substeps) await readAndCache(substep.path);
    invalid.push(...findInvalidSubsteps(
      substeps,
      (path) => contents.get(path) ?? null,
      indexBlob,
      (slug, content) => validateSubstep(slug, content).failures.map((failure) => failure.detail),
    ));
    return invalid;
  }

  async function readResearchIndex(card: WorkerCard) {
    const workspace = await deps.cardWorkspace(card);
    if (!workspace?.path) return { ok: false as const, error: deps.errors.workspaceUnavailable };
    if (!card.dir_hash) return { ok: false as const, error: "No workflow state for this research yet." };
    const stateDir = await deps.workflowStateDir(workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return { ok: false as const, error: "No workflow state for this research yet." };
    const absolute = deps.joinPath(stateDir, "research-index.md");
    const content = await deps.bb.sdk.files.read({ path: absolute }).then((file) => file.content).catch(() => null);
    if (content === null) return { ok: false as const, error: "Research results are still being prepared." };
    return {
      ok: true as const,
      content,
      absolute,
      display: deps.workspaceRelative(workspace.path, absolute) ?? "research-index.md",
    };
  }

  async function researchReadiness(card: WorkerCard): Promise<ResearchReadiness> {
    if (card.kind !== "research") return { ready: false, fingerprint: null, evidence: "verified", invalid: [] };
    const index = await readResearchIndex(card).catch(() => null);
    if (!index || index.ok !== true) return { ready: false, fingerprint: null, evidence: "verified", invalid: [] };
    const evidence = evidenceStatus(index.content);
    if (!isResearchReadyForReview(index.content)) return { ready: false, fingerprint: null, evidence, invalid: [] };
    const invalid = await researchRoundIntegrity(card).catch(() => []);
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

  async function exploreArtifact(card: WorkerCard) {
    const workspace = await deps.cardWorkspace(card);
    if (!workspace?.path || !card.dir_hash || !card.explore_stage) {
      return { ready: false, fingerprint: null, failures: [] as string[] };
    }
    const stateDir = await deps.workflowStateDir(workspace.path, card.id, card.dir_hash).catch(() => null);
    if (!stateDir) return { ready: false, fingerprint: null, failures: [] as string[] };
    const full = deps.joinPath(stateDir, exploreArtifactFile(card.explore_stage));
    const content = await deps.bb.sdk.files.read({ path: full }).then((file) => file.content).catch(() => null);
    if (!isValidExploreContent(content)) return { ready: false, fingerprint: null, failures: [] as string[] };
    const failures = validateExplore(card.explore_stage, content).failures.map((failure) => failure.detail).slice(0, 3);
    if (failures.length > 0) return { ready: false, fingerprint: null, failures };
    return { ready: true, fingerprint: shortFingerprint(content as string), failures: [] as string[] };
  }

  return {
    researchRoundFiles,
    researchRoundIntegrity,
    readResearchIndex,
    researchReadiness,
    exploreArtifact,
    shortFingerprint,
  };
}

export type ResearchArtifactRuntime = ReturnType<typeof createResearchArtifactRuntime>;
