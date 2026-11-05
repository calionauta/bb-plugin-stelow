import { createHash } from "node:crypto";
import { diagnoseScopeSync } from "../../lib/spec-scope-reader.mjs";
import { latestSpecTech, trackingEntryForCard } from "../scopes.js";
import type { WorkerCard } from "../workers-types.js";

export function detailScopeSync(
  card: WorkerCard,
  sourcePath: string | null,
  syncedScopes: number,
) {
  if (card.kind !== "build" || !sourcePath) return null;
  const spec = latestSpecTech(sourcePath, card.id);
  const tracked = trackingEntryForCard(sourcePath, card.id);
  const diagnosis = diagnoseScopeSync({
    specContent: spec?.content ?? null,
    syncedCount: syncedScopes,
    specFile: spec?.file ?? null,
    syncedSpecFile: typeof tracked?.specTechFile === "string" ? tracked.specTechFile : null,
    specSha256: spec ? createHash("sha256").update(spec.content).digest("hex") : undefined,
    syncedSpecSha256: typeof tracked?.specTechSha256 === "string" ? tracked.specTechSha256 : undefined,
  });
  return {
    state: diagnosis.state,
    syncedScopes,
    machineBlocks: diagnosis.machine,
    humanBlocks: diagnosis.human,
    specFile: spec?.file ?? null,
  };
}
