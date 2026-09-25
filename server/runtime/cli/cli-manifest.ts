import {
  buildArtifactTrailer,
  parseArtifactManifest,
} from "../../../lib/artifact-manifest.mjs";
import { readCardStateBlob } from "./cli-card-state.js";
import {
  noCardInContext,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow manifest [--json] [--card <card_id>]";

type ManifestArtifact = {
  stage: string | null;
  kind: string | null;
  label: string | null;
  path: string;
};

/** Commit-message trailer source, not a file attachment: git commits cannot
 * carry files and GitHub shows no git-notes, so the durable audit link is a
 * paste-ready Stelow-Artifacts trailer naming the registered artifacts.
 * Read-only: never writes, never blocks. */
export function createManifestCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "manifest") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, { usage: USAGE });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    return manifestResult(deps, card, json);
  };
}

async function registeredArtifacts(
  deps: CliDeps,
  card: WorkerCard,
): Promise<ManifestArtifact[]> {
  const stateBlob = await readCardStateBlob(deps, card);
  if (!stateBlob) return [];
  return parseArtifactManifest(stateBlob)
    .filter((fields) => typeof fields.path === "string" && fields.path.length > 0)
    .map((fields) => ({
      stage: fields.stage ?? null,
      kind: fields.kind ?? null,
      label: fields.label ?? null,
      path: fields.path as string,
    }));
}

async function manifestResult(
  deps: CliDeps,
  card: WorkerCard,
  json: boolean,
): Promise<CliResult> {
  const artifacts = await registeredArtifacts(deps, card);
  const gapState =
    card.kind === "build" ? await deps.gapState(card).catch(() => null) : null;
  const trailer = buildArtifactTrailer(
    card.id,
    artifacts,
    gapState?.matched ? gapState.totals : null,
  );
  const payload = {
    card: card.id,
    name: card.name,
    stage: card.stage,
    artifacts,
    trailer,
  };
  if (json)
    return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
  return {
    exitCode: 0,
    stdout: [
      `Manifest for ${card.name} (${card.id}) — paste below the commit subject:`,
      ...trailer,
    ].join("\n"),
  };
}
