import {
  RESEARCH_STRATEGIES,
  researchStrategyById,
} from "../../lib/research-strategies.mjs";
import { TECHNIQUE_CATALOG, techniqueById } from "../../lib/stage-catalog.mjs";
import { parseResearchIndex } from "../../lib/research-index.mjs";
import {
  INDEX_PENDING,
  unknownStrategy,
  type ExploreCardInput,
  type ResearchCardInput,
  type ResearchIndexOutput,
  type ResearchIndexRounds,
  type ResearchTrackDeps,
} from "./research-track-deps.js";
import type { WorkerCard } from "../workers-types.js";

// The index file is a worker-written artifact, so the read is capped before it
// crosses the RPC boundary; a card that blows the cap is flagged, not truncated
// silently.
const INDEX_CONTENT_LIMIT = 100_000;

export function createResearchIndexViewHandlers(deps: ResearchTrackDeps) {
  return {
    researchStrategies: () => ({ strategies: RESEARCH_STRATEGIES }),
    createResearchCard: (input: ResearchCardInput) =>
      createResearchCard(deps, input),
    createExploreCard: (input: ExploreCardInput) =>
      createExploreCard(deps, input),
    stageCatalog: () => stageCatalog(),
    researchIndex: (input: { cardId: string }) => researchIndex(deps, input),
  };
}

function createResearchCard(
  deps: ResearchTrackDeps,
  {
    projectId,
    environment,
    prompt,
    attachments,
    strategy,
    presetId,
    start,
    execution,
  }: ResearchCardInput,
) {
  const picked = researchStrategyById(strategy);
  if (!picked) throw new Error(unknownStrategy(strategy));
  return deps.createCard({
    projectId,
    environment,
    prompt,
    attachments,
    intent: "investigate",
    appetite: "Lean",
    reviewMode: "Auto",
    kind: "research",
    strategy: picked.id,
    presetId: presetId ?? null,
    start,
    execution: execution ?? null,
  });
}

function createExploreCard(
  deps: ResearchTrackDeps,
  {
    projectId,
    environment,
    prompt,
    attachments,
    stageId,
    presetId,
    start,
    execution,
  }: ExploreCardInput,
) {
  const picked = techniqueById(stageId);
  if (!picked) {
    throw new Error(
      `Unknown explore technique "${stageId}". Pick one of: ${TECHNIQUE_CATALOG.map((entry) => entry.id).join(", ")}.`,
    );
  }
  return deps.createCard({
    projectId,
    environment,
    prompt,
    attachments,
    intent: "explore",
    appetite: "Complete",
    reviewMode: "Product Spec + Interface + Tech Review + Code Diff",
    kind: "explore",
    stageId: picked.id,
    presetId: presetId ?? null,
    start,
    execution: execution ?? null,
  });
}

function stageCatalog() {
  return {
    stages: TECHNIQUE_CATALOG.map(
      ({ id, label, skill, emoji, blurb, keywords }) => ({
        id,
        label,
        skill,
        emoji,
        blurb,
        keywords,
      }),
    ),
  };
}

function emptyIndex(): Omit<ResearchIndexOutput, "error"> {
  return {
    found: false,
    indexPath: null,
    content: null,
    truncated: false,
    opportunities: [],
    rounds: [],
  };
}

// Resolve the research index file for a card. Shared with the fan-out handler,
// which reads the same file and flips its checkboxes. Returns the error instead
// of throwing so every refusal names its exit.
async function researchIndex(
  deps: ResearchTrackDeps,
  { cardId }: { cardId: string },
): Promise<ResearchIndexOutput> {
  const card = deps.getCard(cardId);
  if (!card) return { ...emptyIndex(), error: deps.errors.cardNotFound };
  if (card.kind !== "research")
    return {
      ...emptyIndex(),
      error:
        "Only research cards have results to review. Build cards track scopes instead.",
    };
  const resolved = await deps.readResearchIndex(card);
  if (!resolved.ok) return { ...emptyIndex(), error: resolved.error };
  const rounds = await indexRounds(deps, card);
  const parsed = parseResearchIndex(resolved.content);
  if (!parsed.found)
    return {
      ...emptyIndex(),
      indexPath: resolved.display,
      rounds,
      error: INDEX_PENDING,
    };
  return {
    found: true,
    indexPath: resolved.display,
    content: resolved.content.slice(0, INDEX_CONTENT_LIMIT),
    truncated: resolved.content.length > INDEX_CONTENT_LIMIT,
    opportunities: parsed.opportunities.map(({ id, title, checked, group }) => ({
      id,
      title,
      checked,
      group,
    })),
    rounds,
    error: null,
  };
}

// Round readiness is workspace-scoped: the index read and the artifact runtime
// must resolve the same workspace and state dir, or a round reports "missing"
// for a file the reader can see. Waiting is activity, never board position.
async function indexRounds(
  deps: ResearchTrackDeps,
  card: WorkerCard,
): Promise<ResearchIndexRounds> {
  const history = deps.strategyRounds(card);
  const live = ["running", "awaiting-answer"].includes(card.activity);
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  const stateDir =
    card.dir_hash && workspace?.path
      ? await deps.workflowStateDir(
          workspace.path,
          card.id,
          card.dir_hash,
        ).catch(() => null)
      : null;
  const { rounds } = await deps.researchRoundFiles(
    workspace?.path ?? null,
    workspace?.hostId ?? null,
    stateDir,
    history,
    live,
  );
  return rounds;
}
