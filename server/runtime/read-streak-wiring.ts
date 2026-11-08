/**
 * The unreadable-read streak, and the two channels it feeds.
 *
 * Per-wiring and not on `core`: this is a counter behind a threshold, and
 * putting it on the shared runtime would make it look like a service every
 * other surface could reach for. It exists because the sync's other two
 * channels for a host fault are both wrong — `last_error` renders a Resume
 * button for a transport fault, and pure silence leaves the next occurrence
 * explained by theory instead of a measurement.
 *
 * Three outputs, one crossing, so they cannot disagree: the operator's warn,
 * the card's latch (returned by the streak table), and the action-log row now
 * fire on the tick the streak reaches `READ_STREAK_WARN_AT`. The log row is the
 * one that survives a reload, which is what turns "the host was flaky again"
 * into a timestamped fact with a card attached.
 *
 * The recovery line stays where it was, next to the read that recovered: a
 * window callback here cannot know that a host came back.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createHostReadStreak } from "../../lib/host-read-streak.mjs";
import type { ActionRecorder } from "./action-log-runtime.js";

export function createReadStreaks(bb: BbPluginApi, actions?: ActionRecorder) {
  return createHostReadStreak((cardId, streak) => {
    bb.log.warn(
      `Stelow could not read card ${cardId}'s workflow state on ${streak} consecutive checks; `
        + "its last verified projection is now stale and no verdict about the card was written. "
        + "The card shows a 'Host not answering' marker from here. "
        + "The host is not answering — no card action fixes this.",
    );
    // One row per outage: the streak warns exactly once at the threshold, so
    // this is not a per-tick write. The cause makes two outages inside the
    // recorder's window collapse into one row with a count, which is the
    // honest shape for "the host flapped twice in ten minutes".
    actions?.record({
      kind: "host.read-miss",
      outcome: "error",
      cause: "host.read-miss",
      cardId,
      detail: { streak },
    });
  });
}
