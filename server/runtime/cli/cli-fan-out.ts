import { z } from "zod";
import {
  noCardInContext,
  usage,
  type CliCommandFn,
  type CliResult,
  type CliRunContext,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";

const USAGE =
  "Usage: bb stelow fan-out --opportunity <id> [--opportunity ...] [--card <card_id>]";

type FanOutArgs = { cardId: string; ids: string[] } | { result: CliResult };

/** Worker-facing entry to the fanOutResearch RPC: opportunity IDs only,
 * never prose. Confirmation happens beforehand via bb stelow ask — this
 * command trusts IDs because the RPC re-validates them against the parsed
 * index (unknown/already-checked ids refuse loudly). */
export function createFanOutCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "fan-out") return null;
    const parsed = fanOutArgs(argv.slice(1), ctx, deps);
    if ("result" in parsed) return parsed.result;
    return fanOut(deps, parsed.cardId, parsed.ids);
  };
}

function fanOutArgs(
  args: string[],
  ctx: CliRunContext,
  deps: CliDeps,
): FanOutArgs {
  const ids: string[] = [];
  let cardId = ctx.threadId
    ? deps.getCardByWorkerThread(ctx.threadId)?.id
    : undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--opportunity") {
      if (args[index + 1]) ids.push(args[index + 1]!);
      index++;
      continue;
    }
    if (args[index] === "--card") {
      cardId = args[index + 1];
      index++;
      continue;
    }
    if (args[index] === "--project") {
      index++;
      continue;
    }
    return { result: usage(USAGE) };
  }
  if (!cardId) return { result: noCardInContext() };
  if (ids.length === 0)
    return {
      result: {
        exitCode: 2,
        stderr:
          "Pass at least one --opportunity <id> (opportunity ids from the research index, never prose).",
      },
    };
  return { cardId, ids };
}

async function fanOut(
  deps: CliDeps,
  cardId: string,
  ids: string[],
): Promise<CliResult> {
  const result = await deps.bb.sdk.plugins.callRpc<{
    ok: boolean;
    created: Array<{ cardId: string; title: string }>;
    error: string | null;
  }>({
    pluginId: "stelow",
    method: "fanOutResearch",
    input: { cardId, opportunityIds: ids },
    // The RPC validates its own output; the CLI only renders the verdict.
    outputSchema: z.any(),
  });
  if (!result.ok)
    return { exitCode: 1, stderr: result.error ?? "fan-out failed" };
  return {
    exitCode: 0,
    stdout: `Fanned out ${result.created.length}: ${result.created
      .map((entry) => `${entry.title} (${entry.cardId})`)
      .join("; ")}`,
  };
}
