import { checkIndexItems, parseResearchIndex } from "../../lib/research-index.mjs";
import { researchStrategyById } from "../../lib/research-strategies.mjs";
import type { CardCreateInput } from "../cards-create.js";
import type { WorkerCard } from "../workers-types.js";
import {
  AGENT_COMMENT_AUTHOR,
  INDEX_PENDING,
  type CreatedCard,
  type IndexResolution,
  type ResearchIndexOpportunity,
  type ResearchTrackDeps,
} from "./research-track-deps.js";

const EXPLORATORY_PROJECT_ID = "proj_personal";
const NONE_AVAILABLE =
  "None of the selected opportunities are still available — reopen the index; they may already have been fanned out.";

type FanOutOutcome = {
  created: CreatedCard[];
  opportunityIds: string[];
  failure: string | null;
};

export function createResearchFanoutHandler(deps: ResearchTrackDeps) {
  return (input: { cardId: string; opportunityIds: string[] }) =>
    fanOutResearch(deps, input);
}

function fanOutRefusal(error: string) {
  return { ok: false as const, created: [] as CreatedCard[], error };
}

async function fanOutResearch(
  deps: ResearchTrackDeps,
  { cardId, opportunityIds }: { cardId: string; opportunityIds: string[] },
) {
  const card = deps.getCard(cardId);
  if (!card) return fanOutRefusal(deps.errors.cardNotFound);
  if (card.kind !== "research")
    return fanOutRefusal(
      "Only research cards fan out. This is already a build card.",
    );
  if (card.status === "archived")
    return fanOutRefusal(deps.errors.cardArchived);
  const resolved = await deps.readResearchIndex(card);
  if (!resolved.ok) return fanOutRefusal(resolved.error);
  const parsed = parseResearchIndex(resolved.content);
  if (!parsed.found) return fanOutRefusal(INDEX_PENDING);
  // Only unchecked, still-selected opportunities are claimable. The RPC
  // re-validates worker-supplied ids against the parsed index, so an unknown
  // or already-fanned id is simply not matched here.
  const wanted = new Set(opportunityIds);
  const matched = parsed.opportunities.filter(
    (item) => wanted.has(item.id) && !item.checked,
  );
  if (matched.length === 0) return fanOutRefusal(NONE_AVAILABLE);
  const outcome = await spawnFanOutCards(deps, card, matched, resolved);
  await checkSpawnedOpportunities(deps, resolved, outcome.opportunityIds);
  if (outcome.created.length > 0) {
    deps.logCardComment(
      cardId,
      "card",
      cardId,
      AGENT_COMMENT_AUTHOR,
      fanOutTrail(outcome.created),
    );
  }
  deps.bb.realtime.publish("card-state", { cardId });
  deps.bb.realtime.publish("board-changed", { cardId });
  if (outcome.failure) {
    return {
      ok: false,
      created: outcome.created,
      error: `${fanOutProgressPrefix(outcome.created)}${outcome.failure}`,
    };
  }
  return { ok: true, created: outcome.created, error: null };
}

// Exploratory research fans out into fresh exploratory build cards (each owns
// its isolated workspace) instead of piling every card's state into the shared
// container directory. Project research stays in its project.
async function spawnFanOutCards(
  deps: ResearchTrackDeps,
  card: WorkerCard,
  matched: ResearchIndexOpportunity[],
  resolved: IndexResolution & { ok: true },
): Promise<FanOutOutcome> {
  const targetProjectId =
    card.workspace_kind === "exploratory"
      ? EXPLORATORY_PROJECT_ID
      : card.project_id;
  const strategyLabel =
    researchStrategyById(card.research_strategy ?? "")?.label ?? "research";
  const outcome: FanOutOutcome = {
    created: [],
    opportunityIds: [],
    failure: null,
  };
  for (const item of matched) {
    try {
      const spawned = await deps.createCard(
        fanOutCardInput(
          card,
          targetProjectId,
          item,
          strategyLabel,
          resolved.absolute,
        ),
      );
      const spawnedCard = deps.getCard(spawned.cardId);
      outcome.created.push({
        cardId: spawned.cardId,
        title: spawnedCard?.display_name ?? spawnedCard?.name ?? item.title,
      });
      outcome.opportunityIds.push(item.id);
    } catch (error) {
      // One spawn failure stops the sweep: a partially fan-out index is
      // recoverable (the boxes that did flip stay flipped), a partially
      // reported one is not.
      outcome.failure =
        error instanceof Error ? error.message : "Could not spawn a build card.";
      break;
    }
  }
  return outcome;
}

function fanOutCardInput(
  card: WorkerCard,
  projectId: string,
  item: ResearchIndexOpportunity,
  strategyLabel: string,
  indexPath: string,
): CardCreateInput {
  return {
    projectId,
    prompt: `Spawned from research "${card.display_name ?? card.name}" (${strategyLabel}).\n\nOpportunity: ${item.title}\n\nResearch context: \
full index at \
${indexPath} — read its ## Summary before triage. Treat the opportunity above as the request; classify intent first, then work it through \
the normal build workflow.`,
    attachments: [],
    intent: "unknown",
    appetite: "Lean",
    reviewMode: "Auto",
    kind: "build",
  };
}

function fanOutTrail(created: CreatedCard[]): string {
  const noun = created.length === 1 ? "opportunity" : "opportunities";
  const titles = created.map((entry) => entry.title).join("; ");
  return `Fanned out ${created.length} ${noun} into build: ${titles}.`;
}

function fanOutProgressPrefix(created: CreatedCard[]): string {
  if (created.length === 0) return "";
  const noun = created.length === 1 ? "build card" : "build cards";
  const prefix = `Created ${created.length} ${noun} before the remaining opportunities`;
  return `${prefix} could not be created. `;
}

// Persist exactly the successfully spawned opportunities before reporting a
// partial failure, so retrying does not duplicate them.
async function checkSpawnedOpportunities(
  deps: ResearchTrackDeps,
  resolved: IndexResolution & { ok: true },
  opportunityIds: string[],
): Promise<void> {
  const flipped = checkIndexItems(resolved.content, opportunityIds);
  if (flipped.checked.length === 0) return;
  try {
    await deps.bb.sdk.files.write({
      path: resolved.absolute,
      content: flipped.updated,
    });
  } catch {
    /* boxes stay unchecked; the comment below still trails */
  }
}
