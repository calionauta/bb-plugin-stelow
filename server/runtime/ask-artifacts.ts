/**
 * The document behind a pending question.
 *
 * A worker attaches evidence with `bb stelow ask --artifact`; the card shows
 * it as an openable option. Three rules make that affordance honest:
 * an unresolvable path never blocks the question (the option stays
 * answerable, it just offers nothing to open); every option inherits the
 * ask's document when only one carried it; and a legacy label-only gate ask
 * recovers its evidence from the card's own manifest instead of mutating the
 * historical interaction payload.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  isPublishableArtifactContent,
  parseArtifactManifest,
  resolveArtifactPath,
} from "../../lib/artifact-manifest.mjs";
import { optionSectionExcerpt } from "../../lib/option-anchor.mjs";
import {
  inheritAskArtifact,
  normalizeAskArtifactPath,
} from "../../lib/question-batch.mjs";
import type { WorkerCard } from "../workers-types.js";
import { join } from "./root-paths.js";
import { workflowStateDir } from "./workflow-state.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type AskArtifact = {
  path: string;
  display: string;
  absolutePath: string | null;
  hostId: string | null;
};

export type AskOption = {
  label: string;
  description: string;
  preview: string | null;
  artifact: { path: string } | null;
};

// Version 0.18.29 started refusing gate asks that had no document or
// preview. Existing cards can still hold older, label-only interactions.
const GATE_ARTIFACT_STAGE: Record<string, string> = {
  gate: "shape",
  "int-gate": "interface",
  selection: "interface",
  "plan-gate": "planning",
};

export type AskArtifactsDeps = {
  bb: BbPluginApi;
  db: Db;
  now: () => number;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (
    card: WorkerCard,
  ) => Promise<{ path: string; hostId: string | null } | null>;
  cardStageSlug: (card: WorkerCard) => Promise<string | null>;
  /** The checkout's git identity, for the staleness baseline. */
  gitEvidence: (path: string) => Promise<{
    gitRoot: string | null;
    headSha: string | null;
  }>;
  sha256OfHostFile: (path: string) => Promise<string | null>;
};

async function resolveAskArtifact(
  deps: AskArtifactsDeps,
  card: WorkerCard,
  rawPath: unknown,
): Promise<AskArtifact | null> {
  const normalized = normalizeAskArtifactPath(rawPath);
  if (!normalized) return null;
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  const full = workspace?.path
    ? resolveArtifactPath(workspace.path, normalized.path)
    : null;
  if (!full || !workspace?.hostId) return null;
  const artifact = await deps.bb.sdk.files.read({ path: full }).catch(() => null);
  if (!artifact || !isPublishableArtifactContent(artifact.content)) {
    return null;
  }
  return { ...normalized, absolutePath: full, hostId: workspace.hostId };
}
async function resolveAskOptions(
  deps: AskArtifactsDeps,
  card: WorkerCard | null,
  options: AskOption[],
): Promise<Array<AskOption & { artifact: AskArtifact | null; artifactInherited: boolean }>> {
  const inherited = inheritAskArtifact(options);
  const noOptionCarriesDocument = inherited.every((artifact) => !artifact);
  const manifestArtifact =
    card && noOptionCarriesDocument
      ? await fallbackGateAskArtifact(deps, card, options.map((option) => option.label)).catch(() => null)
      : null;
  const resolved = new Map<string, AskArtifact | null>();
  const out: Array<AskOption & { artifact: AskArtifact | null; artifactInherited: boolean }> = [];
  for (const [index, option] of options.entries()) {
    const source = inherited[index];
    // Provenance: was this document attached to THIS option, borrowed from a
    // sibling, or recovered from the stage manifest because the ask carried
    // none? Only the first is this option's own evidence, and the card has
    // to say so — one document on four rows otherwise reads as four pieces
    // of evidence about four different options.
    const own = options[index]?.artifact ?? null;
    if (!source || !card) {
      out.push({ ...option, artifact: manifestArtifact, artifactInherited: manifestArtifact !== null });
      continue;
    }
    if (!resolved.has(source.path)) {
      resolved.set(
        source.path,
        await resolveAskArtifact(deps, card, source.path).catch(() => null),
      );
    }
    out.push({ ...option, artifact: resolved.get(source.path) ?? null, artifactInherited: own === null });
  }
  return out;
}
async function fallbackGateAskArtifact(
  deps: AskArtifactsDeps,
  card: WorkerCard,
  optionLabels: string[] = [],
): Promise<AskArtifact | null> {
  const stage = await deps.cardStageSlug(card);
  const artifactStage = stage ? GATE_ARTIFACT_STAGE[stage] : null;
  if (!artifactStage || !card.dir_hash) return null;
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path) return null;
  const stateDir = await workflowStateDir(
    deps.bb,
    workspace.path,
    card.id,
    card.dir_hash,
  ).catch(() => null);
  const stateBlob = stateDir
    ? await deps.bb.sdk.files
        .read({ path: join(stateDir, "state.md") })
        .then((file) => file.content)
        .catch(() => null)
    : null;
  const candidates = stateBlob
    ? parseArtifactManifest(stateBlob).filter(
        (entry) => entry.stage === artifactStage && entry.path,
      )
    : [];
  if (candidates.length === 0) return null;
  const chosen = await documentNamingTheOptions(deps, card, candidates, optionLabels);
  return resolveAskArtifact(deps, card, chosen);
}

/**
 * Which of a stage's registered documents the options were written from.
 *
 * A stage may register more than one document, and manifest order is not
 * evidence of which one a question is about. On a real card the `interface`
 * stage registered four entries, the first of which was a *different* decision
 * than the one being asked — a placement contrast with two options, while the
 * question offered three layouts and a hybrid that lived in a sibling file. The
 * recovery took the first, so every option opened a document with none of their
 * content in it.
 *
 * So the document that actually NAMES the options wins, scored by how many of
 * them resolve to a section of it. Manifest order breaks ties, so the answer is
 * deterministic. With one candidate, or no option labels to score against, this
 * is the old first-match behaviour.
 */
async function documentNamingTheOptions(
  deps: AskArtifactsDeps,
  card: WorkerCard,
  candidates: Array<{ path: string }>,
  optionLabels: string[],
): Promise<string> {
  if (candidates.length === 1) return candidates[0].path;
  const labels = optionLabels.filter((label) => typeof label === "string" && label.length > 0);
  if (labels.length === 0) return candidates[0].path;
  const scores = new Map<string, number>();
  for (const candidate of candidates) {
    const resolved = await resolveAskArtifact(deps, card, candidate.path).catch(() => null);
    const absolute = resolved?.absolutePath ?? null;
    const content = absolute
      ? await deps.bb.sdk.files.read({ path: absolute }).then((file) => file.content).catch(() => null)
      : null;
    scores.set(candidate.path, optionCoverage(content, labels));
  }
  return pickOptionDocument(candidates, scores);
}

/**
 * How many of an ask's options this document actually contains.
 *
 * Unreadable or absent content scores zero rather than throwing, so an
 * unreadable candidate simply loses instead of taking the recovery down.
 */
export function optionCoverage(content: unknown, labels: string[]): number {
  if (typeof content !== "string" || content.length === 0) return 0;
  return labels.filter((label) => optionSectionExcerpt(content, label) !== null).length;
}

/**
 * The document that names the most options wins; manifest order breaks ties, so
 * the choice is deterministic and a stage with one document is unaffected.
 */
export function pickOptionDocument(
  candidates: Array<{ path: string }>,
  scores: Map<string, number>,
): string {
  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scores.get(candidate.path) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best.path;
}
async function snapshotQuestionEvidence(
  deps: AskArtifactsDeps,
  cardId: string,
  optionArtifacts: Array<{ artifact: { path: string } | null }>,
): Promise<void> {
  try {
    const card = deps.getCard(cardId);
    if (!card) return;
    const resolved = await resolveAskOptions(
      deps,
      card,
      optionArtifacts.map((entry) => ({
        label: "",
        description: "",
        preview: null as string | null,
        artifact: entry.artifact,
      })),
    );
    const seen = new Set<string>();
    const workspace = await deps.cardWorkspace(card).catch(() => null);
    const git = workspace?.path
      ? await deps.gitEvidence(workspace.path).catch(() => null)
      : null;
    const askedAt = deps.now();
    for (const option of resolved) {
      const absolute = option.artifact?.absolutePath;
      if (!absolute || seen.has(absolute)) continue;
      seen.add(absolute);
      const sha = await deps.sha256OfHostFile(absolute);
      if (!sha) continue;
      deps.db.prepare(
        "INSERT OR REPLACE INTO question_evidence (card_id, artifact_path, artifact_sha256, git_root, head_sha, asked_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        cardId,
        absolute,
        sha,
        git?.gitRoot ?? null,
        git?.headSha ?? null,
        askedAt,
      );
    }
  } catch {
    /* advisory only */
  }
}

export function createAskArtifacts(deps: AskArtifactsDeps) {
  return {
    resolveAskArtifact: resolveAskArtifact.bind(null, deps),
    resolveAskOptions: resolveAskOptions.bind(null, deps),
    fallbackGateAskArtifact: fallbackGateAskArtifact.bind(null, deps),
    snapshotQuestionEvidence: snapshotQuestionEvidence.bind(null, deps),
  };
}

export type AskArtifacts = ReturnType<typeof createAskArtifacts>;
