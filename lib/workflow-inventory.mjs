/**
 * Which workflow entries a board may show, and which may be pruned.
 *
 * `stelow.json` is append-mostly: a card's entry is written when the card is
 * created and nothing removes it when the card is deleted. The file grew to 77
 * entries against 33 cards, so `bb stelow status` listed 77 workflows
 * "in-progress" — a column a worker reads to answer "is anything waiting on
 * me?", answering with ghosts.
 *
 * The discriminator is the DIRECTORY HASH, not the name or the id shape:
 * `workflows.scopes.ts` writes `sw-card_<cardId>` for a card-owned workflow, and
 * the cardless ones (`sw_<slug>`, made by `ensureWorkflow` for research and
 * explore work) keep their own naming. Guessing from a name prefix would
 * eventually hide a real workflow; the dirHash is what the plugin itself wrote.
 *
 * So: a card-owned entry is visible only while its card row exists, and a
 * cardless entry is always visible — it has no card row by design, and hiding
 * it would lose a workflow that is actually running.
 */

export const CARD_WORKFLOW_PREFIX = "sw-card_";

/** The card id a workflow entry belongs to, or null when it has no card. */
export function cardIdOfWorkflow(workflow) {
  const id = typeof workflow?.id === "string" ? workflow.id : "";
  if (!id.startsWith(CARD_WORKFLOW_PREFIX)) return null;
  const cardId = id.slice(CARD_WORKFLOW_PREFIX.length);
  return cardId || null;
}

/** The entries a board may show: live cards, plus everything cardless. */
export function visibleWorkflows(workflows, cardExists) {
  const list = Array.isArray(workflows) ? workflows : [];
  const exists = typeof cardExists === "function" ? cardExists : () => false;
  return list.filter((workflow) => {
    const cardId = cardIdOfWorkflow(workflow);
    return cardId === null || Boolean(exists(cardId));
  });
}

/** The entries whose card row is gone: prune candidates, never cardless ones. */
export function orphanWorkflows(workflows, cardExists) {
  const list = Array.isArray(workflows) ? workflows : [];
  const exists = typeof cardExists === "function" ? cardExists : () => false;
  return list.filter((workflow) => {
    const cardId = cardIdOfWorkflow(workflow);
    return cardId !== null && !exists(cardId);
  });
}

/**
 * The tracking file with orphans removed, or null when there is nothing to do.
 *
 * Every other key on the document is preserved byte-for-byte in shape: the
 * prune touches `workflows` and nothing else, because the file is shared state
 * and a housekeeping verb is not a writer.
 */
export function withoutOrphans(tracking, cardExists) {
  if (!tracking || typeof tracking !== "object" || Array.isArray(tracking)) return null;
  const workflows = Array.isArray(tracking.workflows) ? tracking.workflows : null;
  if (!workflows) return null;
  const orphans = orphanWorkflows(workflows, cardExists);
  if (orphans.length === 0) return null;
  const kept = workflows.filter((workflow) => !orphans.includes(workflow));
  return { ...tracking, workflows: kept };
}
