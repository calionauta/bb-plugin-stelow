import { cardWorkerSeedRefusal } from "../../../lib/card-seed-guard.mjs";
import { workflowIdForName } from "../../../lib/workflow-state-identity.mjs";
import type { CliCommandFn, CliResult, CliRunContext } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";

const SEED_USAGE =
  "Usage: bb stelow seed --project <proj_id> --name <name> --intent <intent>";

export function createSeedCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) =>
    argv[0] === "seed" ? runSeed(deps, argv, ctx) : null;
}

/** Card workers are pre-seeded at spawn with the card id as owner. A seed from
 * inside a card thread would mint a name-derived owner at the project root —
 * an orphan no card resolves back — so refuse with the card's own state dir as
 * the redirect (lib/card-seed-guard). */
async function seedFromCardWorker(
  deps: CliDeps,
  ctx: CliRunContext,
  projectId: string,
): Promise<CliResult | null> {
  const seedCard = ctx.threadId
    ? deps.getCardByWorkerThread(ctx.threadId)
    : undefined;
  if (!seedCard) return null;
  const seedWorkspace = await deps.cardWorkspace(seedCard);
  const seedRoot = seedWorkspace?.path ?? (await deps.projectRoot(projectId));
  let seedStateDir: string | null = null;
  if (seedRoot && seedCard.dir_hash) {
    seedStateDir = await deps.workflowStateDir(
      seedRoot,
      seedCard.id,
      seedCard.dir_hash,
    );
  }
  return {
    exitCode: 1,
    stderr: cardWorkerSeedRefusal({
      cardName: seedCard.name,
      stateDirText: seedStateDir,
    }),
  };
}

async function runSeed(
  deps: CliDeps,
  argv: string[],
  ctx: CliRunContext,
): Promise<CliResult> {
  const flag = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const projectId = flag("--project") ?? ctx.projectId;
  const name = flag("--name");
  const intent = flag("--intent");
  if (!projectId || !name || !intent)
    return { exitCode: 2, stderr: SEED_USAGE };
  const fromCard = await seedFromCardWorker(deps, ctx, projectId);
  if (fromCard) return fromCard;
  const rootPath = await deps.projectRoot(projectId);
  if (!rootPath)
    return { exitCode: 1, stderr: "Project workspace path is unavailable." };
  const result = await deps.seedWorkflow(
    rootPath,
    workflowIdForName(name),
    name,
    intent,
  );
  return result.error
    ? { exitCode: 1, stderr: result.error }
    : { exitCode: 0, stdout: result.statePath ?? "" };
}
