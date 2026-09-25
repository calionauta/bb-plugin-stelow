import { refuse, usage, type CliCommandFn, type CliResult, type CliRunContext, type Refusal } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const SYNC_SCOPES_USAGE =
  "Usage: bb stelow sync-scopes [--project <proj_id>] [--name <workflow>] [--json]";
const CONFIG_USAGE =
  "Usage: bb stelow config get <field> [default] [--project <proj_id>]";

type HelperContext = {
  rootPath: string;
  stateDir: string | null;
  card: WorkerCard | undefined;
};

/** `sync-scopes`, `scope`, and `config get` are the host-side command wrappers: the host
 * resolves the card's own state dir, guards artifact ownership, then hands the
 * verb to the helper. They share that preamble, so it is written once. */
export function createHelperPassthroughCommands(deps: CliDeps): CliCommandFn[] {
  return [
    createSyncScopesCommand(deps),
    createScopeCommand(deps),
    createConfigCommand(deps),
  ];
}

/** Resolves the workspace and the card's owned state dir, refusing when the
 * workflow state is not this card's to own: project-root state is never
 * silently adopted. */
async function helperContext(
  deps: CliDeps,
  ctx: CliRunContext,
  projectId: string | null,
): Promise<HelperContext | Refusal> {
  const card = ctx.threadId
    ? deps.getCardByWorkerThread(ctx.threadId)
    : undefined;
  const workspace = card ? await deps.cardWorkspace(card) : null;
  const rootPath = workspace?.path ?? (await deps.projectRoot(projectId));
  if (!rootPath)
    return refuse({ exitCode: 1, stderr: "Workspace path is unavailable." });
  const stateDir = card?.dir_hash
    ? await deps.workflowStateDir(rootPath, card.id, card.dir_hash)
    : null;
  const guard = await deps.ensureProjectArtifacts(
    rootPath,
    stateDir,
    Boolean(card?.dir_hash),
  );
  if (guard) return refuse({ exitCode: 1, stderr: guard });
  return { rootPath, stateDir, card };
}

function createSyncScopesCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "sync-scopes") return null;
    const args = argv.slice(1);
    const projectId = flagValue(args, "--project") ?? ctx.projectId ?? null;
    const passthrough = syncScopesPassthrough(args);
    if (!passthrough) return usage(SYNC_SCOPES_USAGE);
    const context = await helperContext(deps, ctx, projectId);
    if ("refusal" in context) return context.refusal;
    const result = await deps.runHelper(
      ["sync-scopes", ...passthrough],
      context.rootPath,
      context.stateDir ?? undefined,
    );
    if (result.code !== 0)
      return {
        exitCode: 1,
        stderr: result.stderr || "sync-scopes failed",
        stdout: result.stdout,
      };
    // Tracking edits are file writes the host cannot watch, so the sync
    // doubles as the refresh signal: the executor runs it after appending
    // discovered tasks or flipping task status, and this publish makes the
    // card reload (ScopeProgress, list, counts) instead of waiting for the
    // next lifecycle event.
    if (context.card) {
      deps.bb.realtime.publish("card-state", { cardId: context.card.id });
      deps.bb.realtime.publish("board-changed", { cardId: context.card.id });
    }
    return { exitCode: 0, stdout: result.stdout };
  };
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Only `--name <workflow>` and `--json` reach the helper (plus `--project`,
 * consumed by the host). Null when anything else is present. */
function syncScopesPassthrough(args: string[]): string[] | null {
  const passthrough: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--project") {
      index++;
      continue;
    }
    if (args[index] === "--name" || args[index] === "--json") {
      passthrough.push(args[index]!);
      if (args[index] === "--name") {
        passthrough.push(args[index + 1] ?? "");
        index++;
      }
      continue;
    }
    return null;
  }
  return passthrough;
}

function createConfigCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "config") return null;
    const args = argv.slice(1);
    if (args[0] !== "get" || !args[1]) return usage(CONFIG_USAGE);
    const parsed = configArgs(args);
    if (parsed.result) return parsed.result;
    const context = await helperContext(deps, ctx, parsed.projectId);
    if ("refusal" in context) return context.refusal;
    const result = await deps.runHelper(
      ["config", ...parsed.rest],
      context.rootPath,
      context.stateDir ?? undefined,
    );
    if (result.code !== 0)
      return {
        exitCode: 1,
        stderr: result.stderr || "config failed",
        stdout: result.stdout,
      };
    return { exitCode: 0, stdout: result.stdout };
  };
}

function configArgs(
  args: string[],
): { rest: string[]; projectId: string | null; result: CliResult | null } {
  const rest: string[] = ["get", args[1]!];
  if (args[2] && !args[2].startsWith("--")) rest.push(args[2]);
  let projectId: string | null = null;
  for (let index = 2; index < args.length; index++) {
    if (args[index] === "--project") {
      projectId = args[index + 1] ?? null;
      index++;
      continue;
    }
    if (args[index] === "--json") continue;
    if (args[index]!.startsWith("--") && args[index] !== args[2])
      return { rest, projectId, result: usage(CONFIG_USAGE) };
  }
  return { rest, projectId, result: null };
}

/** `scope` is the card-scoped scope editor; its implementation already lives
 * in server/scopes with its own contract, so the family is a binding, not a
 * re-implementation. */
export function createScopeCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) =>
    argv[0] === "scope" ? deps.scopeCommand(argv, ctx) : null;
}
