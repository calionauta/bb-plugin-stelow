/**
 * The scope-progress watch: does a card's scope set actually change?
 *
 * A card's board column, its claim indicators, and the progress line in the
 * detail panel are all downstream of "the scopes on disk moved". Polling every
 * card's scope set would be a host round trip per card per tick, so this keeps
 * a fingerprint per card in memory and publishes only when the fingerprint
 * changes. The reconcile tick drives `sync`; `prune` drops cards that no longer
 * exist so the map cannot grow without bound.
 *
 * Separate from `scopes.ts` because it is a different question: that module
 * answers "what are this card's scopes", this one answers "did they just move".
 */
import { scopeFingerprint } from "../lib/scope-fingerprint.mjs";
import { loadCardScopes } from "./scopes.js";

type ScopeProgressCard = {
  id: string;
};

type ScopeProgressDeps<TCard extends ScopeProgressCard> = {
  getCard: (cardId: string) => TCard | undefined;
  cardWorkspace: (card: TCard) => Promise<{ path?: string } | null>;
  publish: (cardId: string) => void;
};

export function createScopeProgressSync<TCard extends ScopeProgressCard>(
  deps: ScopeProgressDeps<TCard>,
) {
  const prints = new Map<string, string>();
  async function sync(cardId: string): Promise<void> {
    try {
      const card = deps.getCard(cardId);
      if (!card) {
        prints.delete(cardId);
        return;
      }
      const workspace = await deps.cardWorkspace(card);
      const print = workspace?.path
        ? scopeFingerprint(loadCardScopes(workspace.path, card.id))
        : "";
      const previous = prints.get(cardId);
      prints.set(cardId, print);
      if (previous !== undefined && previous !== print) deps.publish(cardId);
    } catch {
      // Advisory watch: the next reconcile tick retries.
    }
  }
  function prune(liveIds: ReadonlySet<string>): void {
    for (const id of prints.keys()) if (!liveIds.has(id)) prints.delete(id);
  }
  return { sync, prune };
}
