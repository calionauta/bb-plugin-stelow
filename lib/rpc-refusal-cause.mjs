/**
 * A closed vocabulary for "the handler answered `{ok:false}`".
 *
 * The wrapper used one cause, `rpc.refused`, so a card that was refused four
 * different ways inside ten minutes — archived thread, host hold, no worker,
 * completed card — folded into one row with a count and the LAST error. The
 * count was right and the answer was gone.
 *
 * A fingerprint (as `ui.error` uses) would separate them but read as an opaque
 * hex code. These rules name the refusal in words, because the vocabulary is
 * small and known: a new reason is a new rule here, next to the test that pins
 * it, not a new string invented at a call site.
 */
const RULES = [
  [/thread is archived|archived thread/i, "thread-archived"],
  [/waiting on the host|host is full|of \d+ running on host/i, "host-hold"],
  [/has no worker thread/i, "no-thread"],
  [/no recovery question awaits|no question was answered/i, "no-question"],
  [/completed/i, "card-completed"],
  [/archived/i, "card-archived"],
  [/not found|unknown card/i, "not-found"],
  [/validation/i, "validation"],
];

/** `rpc.refused.<reason>`, or plain `rpc.refused` when no rule matches. */
export function rpcRefusalCause(message) {
  const text = typeof message === "string" ? message : String(message ?? "");
  for (const [pattern, code] of RULES) {
    if (pattern.test(text)) return `rpc.refused.${code}`;
  }
  return "rpc.refused";
}
