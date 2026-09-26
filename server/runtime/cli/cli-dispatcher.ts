import { cliUnknownResult } from "../cli-registry.js";
import { createAnswerCommand, type AnswerDoors } from "./cli-answer.js";
import { createAskCommand } from "./cli-ask.js";
import { createBundleWriter } from "./cli-bundle-writer.js";
import { createCriteriaCommand } from "./cli-criteria.js";
import { createDelegatedCommands } from "./cli-draft.js";
import { createDoneCommand } from "./cli-done.js";
import { createExportCommand } from "./cli-export.js";
import { createFanOutCommand } from "./cli-fan-out.js";
import { createGapScopesCommand } from "./cli-gap-scopes.js";
import { createGapTriageCommand } from "./cli-gap-triage.js";
import { createHelperPassthroughCommands } from "./cli-helper-passthrough.js";
import { createLockCommand } from "./cli-lock.js";
import { createManifestCommand } from "./cli-manifest.js";
import { createMetricsCommand } from "./cli-metrics.js";
import { createPreviewCommand } from "./cli-preview.js";
import { createReviewCommand } from "./cli-review.js";
import { createSeedCommand } from "./cli-seed.js";
import { createSplitCommand } from "./cli-split.js";
import { createStorageCommand } from "./cli-storage.js";
import { createVerifyCommand } from "./cli-verify.js";
import { createVerifyDelegationCommand } from "./cli-verify-delegation.js";
import { createVerifyTasksCommand } from "./cli-verify-tasks.js";
import type { CliCommandFn, CliResult, CliRunContext } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";

/** The command table, in the order the verbs are decided. Families that share
 * a lifecycle (the bundle writer, the helper passthroughs) are declared once
 * and flattened, so a verb has exactly one owner and adding a family is one
 * line. */
function commandTable(deps: CliDeps, doors: AnswerDoors): CliCommandFn[] {
  const exportRunBundle = createBundleWriter(deps);
  return [
    createAskCommand(deps),
    createAnswerCommand(deps, doors),
    createSeedCommand(deps),
    createAdvanceCommand(deps),
    createGapScopesCommand(deps),
    createMetricsCommand(deps),
    createStorageCommand(deps),
    createManifestCommand(deps),
    createExportCommand(deps, exportRunBundle),
    createDoneCommand(deps, exportRunBundle),
    createSplitCommand(deps),
    ...createHelperPassthroughCommands(deps),
    createLockCommand(deps),
    createPreviewCommand(deps),
    createFanOutCommand(deps),
    createVerifyCommand(deps),
    createReviewCommand(deps),
    createCriteriaCommand(deps),
    createVerifyTasksCommand(deps),
    createVerifyDelegationCommand(deps),
    createGapTriageCommand(deps),
    ...createDelegatedCommands(deps),
  ];
}

/** `advance` is already a host-owned module with its own CLI contract
 * (server/execution-advance); the family here only claims the verb. */
function createAdvanceCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) =>
    argv[0] === "advance"
      ? deps.advanceCli(argv, { threadId: ctx.threadId, projectId: ctx.projectId })
      : null;
}

/** `bb stelow <verb>`: inspection first (status/playbook/doctor/schema), then
 * the command families in table order, then the shared unknown-command
 * suggestion. A family returns null for verbs it does not own, so exactly one
 * family answers any verb. */
export function createStelowCliRun(deps: CliDeps, doors: AnswerDoors) {
  const commands = commandTable(deps, doors);
  return async function runCliCommand(
    argv: string[],
    ctx: CliRunContext,
  ): Promise<CliResult> {
    const inspection = await deps.runInspection(argv, ctx);
    if (inspection) return inspection;
    for (const command of commands) {
      const result = await command(argv, ctx);
      if (result) return result;
    }
    return cliUnknownResult(argv);
  };
}
