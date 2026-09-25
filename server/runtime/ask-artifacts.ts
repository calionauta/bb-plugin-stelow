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

export function createAskArtifacts(deps: AskArtifactsDeps) {
  /**
   * Resolve a worker-authored artifact path (workspace-relative) into the
   * viewer-ready shape. Fail-soft by design: an unresolvable path yields
   * null and the option stays fully answerable — a bad path never blocks the
   * question, it just offers no open affordance.
   */
  async function resolveAskArtifact(
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

  /**
   * Per-option artifacts for one rendered ask. A worker that attached
   * `--artifact` to a single option used to leave every other option —
   * including the approval — with nothing to open, because the evidence gate
   * only requires one option to carry evidence and the old manifest fallback
   * fired only when NO option had any. Every option now inherits the ask's
   * document (lib/question-batch inheritAskArtifact), and the manifest
   * recovery still covers asks that attached nothing at all.
   */
  async function resolveAskOptions(
    card: WorkerCard | null,
    options: AskOption[],
  ): Promise<Array<AskOption & { artifact: AskArtifact | null }>> {
    const inherited = inheritAskArtifact(options);
    const noOptionCarriesDocument = inherited.every((artifact) => !artifact);
    const manifestArtifact =
      card && noOptionCarriesDocument
        ? await fallbackGateAskArtifact(card).catch(() => null)
        : null;
    const resolved = new Map<string, AskArtifact | null>();
    const out: Array<AskOption & { artifact: AskArtifact | null }> = [];
    for (const [index, option] of options.entries()) {
      const source = inherited[index];
      if (!source || !card) {
        out.push({ ...option, artifact: manifestArtifact });
        continue;
      }
      if (!resolved.has(source.path)) {
        resolved.set(
          source.path,
          await resolveAskArtifact(card, source.path).catch(() => null),
        );
      }
      out.push({ ...option, artifact: resolved.get(source.path) ?? null });
    }
    return out;
  }

  /**
   * Recover a legacy gate ask's document from the card's own manifest, so
   * Approve plan and Request changes receive the same per-option document
   * affordance as a fresh ask.
   */
  async function fallbackGateAskArtifact(
    card: WorkerCard,
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
    const manifestEntry = stateBlob
      ? parseArtifactManifest(stateBlob).find(
          (entry) => entry.stage === artifactStage && entry.path,
        )
      : null;
    return manifestEntry
      ? resolveAskArtifact(card, manifestEntry.path)
      : null;
  }

  /**
   * Ask-time evidence baseline for staleness notices. Advisory and fail-soft:
   * a question must never fail because its baseline could not be recorded.
   * Keyed by (card, artifact path), latest wins — re-asking about a revised
   * document re-baselines it.
   */
  async function snapshotQuestionEvidence(
    cardId: string,
    optionArtifacts: Array<{ artifact: { path: string } | null }>,
  ): Promise<void> {
    try {
      const card = deps.getCard(cardId);
      if (!card) return;
      const resolved = await resolveAskOptions(
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

  return { resolveAskArtifact, resolveAskOptions, snapshotQuestionEvidence };
}

export type AskArtifacts = ReturnType<typeof createAskArtifacts>;
