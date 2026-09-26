import {
  type CliCommandFn,
  type CliResult,
  type CliRunContext,
} from "./cli-contract.js";
import type { PresetUpsertInput } from "../../preset-contracts.js";
import type { CliDeps } from "./cli-deps.js";

/** `draft` and `preset` are pure delegations to hosts that already own their
 * contract (the drafting server, the preset server). They are bound here so
 * the dispatcher stays a table and neither server has to know about argv. */
export function createDelegatedCommands(deps: CliDeps): CliCommandFn[] {
  return [createDraftCommand(deps), createPresetCommand(deps)];
}

function createDraftCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "draft") return null;
    // A null verdict means "not a drafting verb": the dispatcher keeps
    // walking, exactly as the inline `if (result) return result` did.
    return deps.draftingCommand(argv, ctx.threadId ?? undefined);
  };
}

const PRESET_USAGE = "Usage: bb stelow preset list|add|remove|assign";

function createPresetCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "preset") return null;
    const sub = argv[1];
    const refusal = presetWorkerRefusal(deps, sub, ctx);
    if (refusal) return refusal;
    if (!sub || sub === "list") return listPresets(deps);
    if (sub === "add") return addPreset(deps, argv);
    if (sub === "remove") return removePreset(deps, argv);
    if (sub === "assign") return assignPreset(deps, argv);
    return { exitCode: 2, stderr: PRESET_USAGE };
  };
}

/** Preset mutation is a host/UI concern (card Agent preset section, Presets
 * screen). A worker thread rewriting the shared preset pool mid-flight would
 * change the brains of every other card — refuse with the redirect. Listing
 * stays open (workers read their assignment). */
function presetWorkerRefusal(
  deps: CliDeps,
  sub: string | undefined,
  ctx: CliRunContext,
): CliResult | null {
  if (sub !== "add" && sub !== "remove" && sub !== "assign") return null;
  if (!ctx.threadId || !deps.getCardByWorkerThread(ctx.threadId)) return null;
  return {
    exitCode: 1,
    stderr:
      "Refused: presets are managed from the card's Agent preset section (or the Presets screen), never by a worker thread. If you need \
a different brain for this phase, ask for it via `bb stelow ask` instead of reassigning presets yourself.",
  };
}

async function listPresets(deps: CliDeps): Promise<CliResult> {
  const listed = await deps.presets.handlers.listPresets();
  return {
    exitCode: 0,
    stdout: listed.presets
      .map((row) =>
        [
          row.id,
          row.isDefault ? "*" : " ",
          row.builtIn ? "B" : " ",
          row.name,
          `${row.providerId}/${row.modelId}`,
          row.reasoningLevel,
          row.permissionMode,
        ].join("\t"),
      )
      .join("\n"),
  };
}

const ADD_USAGE =
  "Usage: bb stelow preset add --name <name> [--provider <id>] [--model <id>] [--reasoning <level>] [--permission <mode>] [--workspace \
<kind>] [--instructions <text>]";

async function addPreset(deps: CliDeps, argv: string[]): Promise<CliResult> {
  const args = argv.slice(2);
  const flag = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const name = flag("--name");
  if (!name) return { exitCode: 2, stderr: ADD_USAGE };
  const permissionMode = flag("--permission") ?? "full";
  const input: PresetUpsertInput = {
    id: null,
    name,
    providerId: flag("--provider") ?? "pi",
    modelId: flag("--model") ?? "bifrost/harness-coding",
    reasoningLevel: flag("--reasoning") ?? "medium",
    permissionMode: permissionMode as PresetUpsertInput["permissionMode"],
    environmentKind: (flag("--workspace") ??
      "project-default") as "project-default" | "new-worktree",
    baseBranch: null,
    machineId: null,
    instructions: flag("--instructions") ?? "",
  };
  try {
    const result = await deps.presets.handlers.upsertPreset(input);
    return {
      exitCode: 0,
      stdout: `OK ${result.preset.id} ${result.preset.name}`,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stderr:
        error instanceof Error ? error.message : "Unable to add preset.",
    };
  }
}

async function removePreset(deps: CliDeps, argv: string[]): Promise<CliResult> {
  const id = argv[2];
  if (!id) return { exitCode: 2, stderr: "Usage: bb stelow preset remove <id>" };
  const result = await deps.presets.handlers.deletePreset({ id });
  if (!result.deleted)
    return { exitCode: 1, stderr: result.error ?? "Could not remove preset." };
  return { exitCode: 0, stdout: `Removed ${id}` };
}

const ASSIGN_USAGE =
  "Usage: bb stelow preset assign --card <card_id> --preset <preset_id>";

async function assignPreset(deps: CliDeps, argv: string[]): Promise<CliResult> {
  const args = argv.slice(2);
  const flag = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const cardId = flag("--card");
  const presetId = flag("--preset");
  if (!cardId || !presetId)
    return { exitCode: 2, stderr: ASSIGN_USAGE };
  const result = await deps.presets.handlers.assignPreset({ cardId, presetId });
  if (!result.ok)
    return { exitCode: 1, stderr: result.error ?? "Could not assign preset." };
  return { exitCode: 0, stdout: `Assigned ${presetId} to ${cardId}` };
}
