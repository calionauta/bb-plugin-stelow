import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "../workers-types.js";
import { workflowStateDir } from "./workflow-state.js";

/**
 * The one reader for a card's review records.
 *
 * Three callers need "the reviews this card ran": the done gate checks that a
 * passing review covers the artifact, the metrics readout counts how much of
 * each artifact the reviewer actually saw, and the flow strip reports that over
 * a fleet. Three copies of this list-and-read is how they would start
 * disagreeing about which reviews exist — and the disagreement would be silent,
 * because each would still return a plausible list.
 *
 * So the shape is a plain list of `{ name, content }` and every caller decides
 * what to do with it. `lib/review-verdict.mjs` owns the parsing; this owns only
 * the addressing.
 *
 * Fail-soft by contract: a card with no workspace, no dir hash, or an
 * unreadable directory has no review records. That is different from a card
 * whose reviews all passed — callers must not read an empty list as "nothing
 * was reviewed" without saying so, and an absent record never becomes a
 * truncated one.
 */

export type ReviewFile = { name: string; content: string | null };

export type ReviewRecordsDeps = {
  bb: BbPluginApi;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string } | null>;
};

/** The newest-first review documents on a card, or [] when there are none to
 * read. Never throws: a workspace that moved is a card with no readable
 * reviews, not a board panel that fails to render. */
export async function readReviewFiles(
  deps: ReviewRecordsDeps,
  card: WorkerCard,
): Promise<ReviewFile[]> {
  if (!card.dir_hash) return [];
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path) return [];
  const stateDir = await workflowStateDir(
    deps.bb,
    workspace.path,
    card.id,
    card.dir_hash,
  ).catch(() => null);
  if (!stateDir) return [];
  try {
    const listed = await deps.bb.sdk.files.listPaths({
      path: join(stateDir, "reviews"),
      includeFiles: true,
      includeDirectories: false,
    });
    const paths = (Array.isArray(listed?.paths) ? listed.paths : [])
      .map((entry) => (typeof entry === "string" ? entry : String(entry?.path ?? "")))
      .filter((path) => path.endsWith(".md"))
      .sort()
      .reverse();
    const files: ReviewFile[] = [];
    for (const path of paths) {
      const content = await deps.bb.sdk.files
        .read({ path })
        .then((f) => f.content)
        .catch(() => null);
      files.push({ name: path.split("/").pop() ?? path, content });
    }
    return files;
  } catch {
    return [];
  }
}
