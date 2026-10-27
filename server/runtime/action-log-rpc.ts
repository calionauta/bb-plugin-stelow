/**
 * The RPC boundary recorder.
 *
 * A plugin with 120+ RPC methods cannot ask every handler to log itself: the
 * first handler written after this file is forgotten is the one that matters.
 * So the wrapper sits at the single registration point and records one row per
 * invocation — the name, the caller's card, the duration, and whether it
 * returned or threw.
 *
 * What it deliberately does NOT record: the input. RPC inputs carry prompts,
 * questions and artifact bodies; a recorder that copies them is a second copy
 * of the database and a privacy surface that grows on its own. The id is
 * enough to join to the card, and the card holds the prose.
 *
 * A validation rejection never reaches here: BB validates against the contract
 * before calling the handler, which is why the wrapper's `rpc.error` means "the
 * handler threw" and nothing else. BB's own warn line covers validation, and
 * its missing field path is an upstream fix, not something this file can
 * recover.
 */
import type { ActionRecorder } from "./action-log-runtime.js";

type Handler = (...args: unknown[]) => unknown;
type HandlerBag = Record<string, Handler>;

/** A code, not a sentence — see `lib/action-kinds.mjs`. */
function errorCause(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "NeedsConfigurationError") return "rpc.config";
  if (/validat/i.test(message)) return "rpc.validation";
  if (/timed out|timeout/i.test(message)) return "rpc.timeout";
  if (/not found|unknown/i.test(message)) return "rpc.not-found";
  return "rpc.error";
}

function inputString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function messageOf(error: unknown, limit = 300): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > limit ? `${message.slice(0, limit)}…` : message;
}

/**
 * Wrap every handler with one recorder row. Returns a new bag: the input map
 * belongs to the caller, and mutating it in place would make a test that
 * registers twice record twice.
 */
export function withActionRecorder<Handlers extends HandlerBag>(
  handlers: Handlers,
  actions: ActionRecorder,
  now: () => number = Date.now,
  /** Resolves a thread-only input to its card, for the few lookups whose
   * contract has no `cardId` (`cardByWorkerThread`). Optional: without it the
   * row is still written, attributed to the thread. */
  resolveCardId?: (threadId: string) => string | null,
): Handlers {
  const wrapped: HandlerBag = {};
  for (const [name, handler] of Object.entries(handlers)) {
    if (typeof handler !== "function") {
      wrapped[name] = handler;
      continue;
    }
    wrapped[name] = async (...args: unknown[]) => {
      const started = now();
      const input = args[0];
      const threadId = inputString(input, "threadId");
      const cardId = inputString(input, "cardId") ?? cardFromThread(threadId, resolveCardId);
      try {
        const output = await handler(...args);
        actions.record({
          kind: "rpc.call",
          actor: "client",
          outcome: "ok",
          cardId,
          threadId,
          durationMs: now() - started,
          detail: { name },
        });
        return output;
      } catch (error) {
        actions.record({
          kind: "rpc.call",
          actor: "client",
          outcome: "error",
          cause: errorCause(error),
          cardId,
          threadId,
          durationMs: now() - started,
          detail: { name, message: messageOf(error) },
        });
        throw error;
      }
    };
  }
  return wrapped as Handlers;
}

/** A resolver is allowed to fail: an unreadable lookup costs the attribution,
 * never the row. */
function cardFromThread(
  threadId: string | null,
  resolve: ((threadId: string) => string | null) | undefined,
): string | null {
  if (!threadId || !resolve) return null;
  try {
    return resolve(threadId) ?? null;
  } catch {
    return null;
  }
}
