import type { CliResult, CliRunContext } from "../cli-dispatch.js";
import type { WorkerCard } from "../../workers-types.js";

export type { CliResult, CliRunContext };

/** One command family owns one (or a few) CLI verbs. A family returns null
 * when the verb is not its own, so the dispatcher can walk the table in
 * registration order and keep unknown-command handling in one place. */
export type CliCommandFn = (
  argv: string[],
  context: CliRunContext,
) => Promise<CliResult | null>;

/** The refusals every card-scoped family repeats. Shared wording means the
 * same failure reads the same on every surface, fixed in one place. */
export const ERR_CARD_ARCHIVED = "This card is archived.";
export const ERR_WORKSPACE_UNAVAILABLE = "Workspace is unavailable.";

export function noCardInContext(): CliResult {
  return {
    exitCode: 2,
    stderr:
      "No card in context (run from the worker thread or pass --card <card_id>).",
  };
}

export function unknownCard(cardId: string): CliResult {
  return { exitCode: 2, stderr: `Unknown card "${cardId}".` };
}

export function archivedCard(): CliResult {
  return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
}

export function usage(stderr: string): CliResult {
  return { exitCode: 2, stderr };
}

/** A refusal is a distinct value, not a bare `CliResult`: helpers that also
 * return data (a card row, a bundle) would otherwise be unnarrowable, since
 * `CliResult` has optional fields. `refusal` is the discriminant every such
 * helper checks. */
export type Refusal = { refusal: CliResult };

export function refuse(result: CliResult): Refusal {
  return { refusal: result };
}

export function cardFromThread(
  context: CliRunContext,
  getCardByWorkerThread: (threadId: string) => WorkerCard | undefined,
): string | undefined {
  return context.threadId
    ? getCardByWorkerThread(context.threadId)?.id
    : undefined;
}

export type FlagScan =
  | { ok: true; flags: Record<string, string | undefined> }
  | { ok: false; result: CliResult };

/** Walks the argv tail of a card-scoped family, accepting exactly the flags it
 * declares. Any other token is a usage refusal (exit 2), never a silent
 * ignore — a mistyped flag must not read as "the flag was not set". Boolean
 * flags carry no value; a valued flag always consumes the next token, even
 * when that token is missing (the family's own guard then refuses). */
export function scanFlags(
  args: string[],
  options: { boolean: string[]; valued: string[]; usage: string },
): FlagScan {
  const flags: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!;
    if (options.boolean.includes(token)) {
      flags[token.slice(2)] = "true";
      continue;
    }
    if (options.valued.includes(token)) {
      flags[token.slice(2)] = args[index + 1];
      index++;
      continue;
    }
    return { ok: false, result: usage(options.usage) };
  }
  return { ok: true, flags };
}

export type CardIdScan = {
  cardId?: string;
  flags: Record<string, string | undefined>;
  result?: CliResult;
};

/** `--card` wins over the worker thread's own card: an explicit argument is
 * the caller stating which card it means, the thread is only the default. */
export function scanCardId(
  args: string[],
  context: CliRunContext,
  getCardByWorkerThread: (threadId: string) => WorkerCard | undefined,
  options: { usage: string; boolean?: string[]; valued?: string[] },
): CardIdScan {
  const scan = scanFlags(args, {
    boolean: options.boolean ?? ["--json"],
    valued: options.valued ?? ["--card"],
    usage: options.usage,
  });
  if (!scan.ok) return { flags: {}, result: scan.result };
  return {
    cardId:
      "card" in scan.flags
        ? scan.flags.card
        : cardFromThread(context, getCardByWorkerThread),
    flags: scan.flags,
  };
}
