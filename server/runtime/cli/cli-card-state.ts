import { join } from "node:path";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

/** The card's own `state.md` is the registration source of truth for every
 * artifact-reading command (manifest, export, review). An unreadable
 * workspace or state dir reads as "no state" rather than failing the command:
 * the caller decides what an absent state means for its own verdict. */
export async function readCardStateBlob(
  deps: CliDeps,
  card: WorkerCard,
): Promise<string | null> {
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  const stateDir =
    workspace?.path && card.dir_hash
      ? await deps
          .workflowStateDir(workspace.path, card.id, card.dir_hash)
          .catch(() => null)
      : null;
  if (!stateDir) return null;
  return deps.bb.sdk.files
    .read({ path: join(stateDir, "state.md") })
    .then((file) => file.content)
    .catch(() => null);
}
