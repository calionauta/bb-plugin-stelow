import { previewShape } from "../../lib/preview-session.mjs";
import type { PreviewRuntime, PreviewTarget } from "../../lib/preview-runtime.mjs";

type PreviewCard = {
  name: string;
};

type CardCheckout = {
  path: string;
  hostId: string | null;
  source: string;
};

type CardPreviewDeps<T extends PreviewCard> = {
  getCard: (cardId: string) => T | undefined;
  cardCheckout: (card: T) => Promise<CardCheckout | null>;
  runtime: PreviewRuntime;
  cardNotFoundError: string;
};

const NO_PREVIEW_WORKSPACE = "Workspace path is unavailable.";

export function createCardPreview<T extends PreviewCard>(deps: CardPreviewDeps<T>) {
  async function targetFor(cardId: string): Promise<PreviewTarget | null> {
    const card = deps.getCard(cardId);
    if (!card) throw new Error(deps.cardNotFoundError);
    const checkout = await deps.cardCheckout(card);
    return checkout
      ? { checkout: checkout.path, hostId: checkout.hostId, slug: card.name, source: checkout.source }
      : null;
  }

  async function view(cardId: string, appOrigin: string | null = null) {
    const target = await targetFor(cardId);
    if (!target) return previewShape({ error: NO_PREVIEW_WORKSPACE });
    return await deps.runtime.view(target, appOrigin);
  }

  async function start(cardId: string) {
    const target = await targetFor(cardId);
    if (!target) return { ok: false, error: NO_PREVIEW_WORKSPACE };
    return await deps.runtime.start(target);
  }

  async function stop(cardId: string) {
    const target = await targetFor(cardId);
    if (!target) return { ok: false, error: NO_PREVIEW_WORKSPACE };
    return await deps.runtime.stop(target);
  }

  async function share(cardId: string) {
    const target = await targetFor(cardId);
    if (!target) return { ok: false, error: NO_PREVIEW_WORKSPACE };
    return await deps.runtime.share(target);
  }

  return { view, start, stop, share };
}
