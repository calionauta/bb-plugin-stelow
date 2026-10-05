import { join } from "node:path";
import {
  FROZEN_ACCEPTANCE_FILE,
  frozenDetailView,
  parseFrozenAcceptance,
} from "../../lib/audit-verification.mjs";
import type { WorkerCard } from "../workers-types.js";

/** Narrow seam for the frozen read: the whole CardDetailDeps is not needed. */
export type FrozenDetailDeps = {
  bb: {
    sdk: {
      files: {
        read: (input: { path: string }) => Promise<{ content?: unknown } | null>;
      };
    };
  };
  stateDir: (sourcePath: string, card: WorkerCard) => Promise<string | null>;
  verifiedHeadSha: (cardId: string) => string | null;
};

export type FrozenDetailView =
  | {
    frozenTestMap: Array<{ test: string; frozen: boolean; redProof: unknown }>;
    freezeSha: string | null;
    currentHeadSha: string | null;
  }
  | null;

/** The frozen technical acceptance the hero mirrors beside the human
 * receipt. Read here, on the detail, for the same reason as the hold: the
 * board would pay per card for state only an opened card asks about. Null
 * when there is no snapshot (or no mappable entry) — the row renders
 * nothing instead of warning about a freeze it does not hold. */
export async function readFrozenAcceptance(
  deps: FrozenDetailDeps,
  card: WorkerCard,
  sourcePath: string | null,
): Promise<FrozenDetailView> {
  if (card.kind !== "build" || !sourcePath || !card.dir_hash) return null;
  try {
    const stateDir = await deps.stateDir(sourcePath, card).catch(() => null);
    if (!stateDir) return null;
    const content = await deps.bb.sdk.files
      .read({ path: join(stateDir, FROZEN_ACCEPTANCE_FILE) })
      .then((file) => file?.content)
      .catch(() => null);
    if (typeof content !== "string") return null;
    return frozenDetailView(parseFrozenAcceptance(content), deps.verifiedHeadSha(card.id));
  } catch {
    return null;
  }
}
