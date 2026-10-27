import { stelowCliCommands, cliHelpResult, cliUnknownResult } from "./cli-registry.js";
import type { ActionRecorder } from "./action-log-runtime.js";

export type CliRunContext = { projectId?: string | null; threadId?: string | null; signal?: AbortSignal };

/**
 * `reason` is a dotted code — `done.audit-trail`, `cli.usage` — and it is what
 * makes a refusal countable. It stays optional: the dispatcher infers an
 * outcome from the exit code for every command that does not name one, so a
 * command written before this field existed still records as a refusal rather
 * than as silence.
 */
export type CliResult = { exitCode: number; stdout?: string; stderr?: string; reason?: string };

export type CliDispatchDeps = {
  run: (argv: string[], context: CliRunContext) => Promise<CliResult>;
  /** Absent in narrow tests; the dispatch must work without a recorder. */
  actions?: ActionRecorder;
  now?: () => number;
};

/**
 * Keeps command registration declarative. The command-specific implementation
 * stays in the composition root, while unknown/help behavior is testable and
 * cannot drift from the advertised command list.
 *
 * The recorder wraps the same seam, so every verb — including `help` and the
 * unknown-command suggestion — leaves one row. Without that, 908 CLI failures
 * in five weeks had no denominator: nothing recorded the invocations that
 * worked, so "162 `done` failures" could not be read as a rate.
 */
export function createCliDispatch(deps: CliDispatchDeps) {
  const now = deps.now ?? Date.now;

  async function route(argv: string[], context: CliRunContext): Promise<CliResult> {
    if (argv[0] === "help") return cliHelpResult(argv);
    if (!argv[0]) return cliUnknownResult(argv);
    return deps.run(argv, context);
  }

  return async function dispatch(argv: string[], context: CliRunContext): Promise<CliResult> {
    const started = now();
    const verb = argv[0] ?? "";
    const cardId = flagValue(argv, "--card");
    try {
      const result = await route(argv, context);
      recordCliResult(deps, { verb, cardId, threadId: context.threadId ?? null, result, started, now });
      return result;
    } catch (error) {
      recordCliFailure(deps, { verb, cardId, threadId: context.threadId ?? null, error, started, now });
      throw error;
    }
  };
}

type CallContext = {
  verb: string;
  cardId: string | null;
  threadId: string | null;
};

function recordCliResult(
  deps: CliDispatchDeps,
  call: CallContext & { result: CliResult; started: number; now: () => number },
): void {
  deps.actions?.record({
    kind: "cli.call",
    actor: "agent",
    outcome: call.result.exitCode === 0 ? "ok" : "refused",
    // A successful call repeats far more often than it names a condition, and
    // a cause is what makes the recorder collapse repeats. Only the refusals
    // carry one.
    cause: call.result.exitCode === 0
      ? null
      : (call.result.reason ?? causeForExit(call.result.exitCode)),
    cardId: call.cardId,
    threadId: call.threadId,
    durationMs: call.now() - call.started,
    detail: {
      verb: call.verb,
      exitCode: call.result.exitCode,
      ...(call.result.exitCode === 0 ? {} : { message: firstLine(call.result.stderr) }),
    },
  });
}

function recordCliFailure(
  deps: CliDispatchDeps,
  call: CallContext & { error: unknown; started: number; now: () => number },
): void {
  deps.actions?.record({
    kind: "cli.call",
    actor: "agent",
    outcome: "error",
    cause: "cli.exception",
    cardId: call.cardId,
    threadId: call.threadId,
    durationMs: call.now() - call.started,
    detail: {
      verb: call.verb,
      message: firstLine(call.error instanceof Error ? call.error.message : String(call.error)),
    },
  });
}

/** 2 is the CLI's usage/no-card exit; 1 is a refusal with a written reason. */
function causeForExit(exitCode: number): string {
  if (exitCode === 2) return "cli.usage";
  if (exitCode === 1) return "cli.refused";
  return "cli.failed";
}

function firstLine(value: string | undefined, limit = 300): string {
  const line = String(value ?? "").trim().split("\n")[0] ?? "";
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

/** `--card X` and `--card=X`, which are the two spellings the CLI accepts. */
function flagValue(argv: string[], flag: string): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === flag) {
      const next = argv[index + 1];
      return typeof next === "string" && !next.startsWith("-") ? next : null;
    }
    if (arg.startsWith(`${flag}=`)) {
      const value = arg.slice(flag.length + 1);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

export { stelowCliCommands };
