import { z } from "zod";

/**
 * The card's own activity, as the plugin recorded it.
 *
 * Read-only and capped: this is the flight recorder turned into a section, and
 * a section that could stream a fleet's worth of rows would be a second log
 * viewer. The detail stays a JSON string because the reader who needs the
 * payload already has `bb stelow log --json`; the card renders the row.
 */
export const activityRpcContract = {
  /**
   * A browser-side failure the server would otherwise never hear about. The
   * client sends the sentence, never a payload: the row is a pointer into the
   * browser console, and `detail` is capped by the recorder like every other.
   */
  reportClientError: {
    experimental_description: "Record a client-side Stelow error in the plugin's action log",
    input: z
      .object({
        surface: z.string().min(1).max(40),
        message: z.string().min(1).max(1000),
        stack: z.string().max(4000).optional(),
        cardId: z.string().min(1).optional(),
      })
      .strict(),
    output: z.object({ ok: z.boolean() }),
  },
  cardActivity: {
    experimental_description: "What the plugin recorded doing on this card: RPCs, decisions, effects",
    input: z
      .object({
        cardId: z.string().min(1),
        limit: z.number().int().positive().max(200).optional(),
      })
      .strict(),
    output: z.object({
      rows: z.array(
        z.object({
          at: z.number(),
          kind: z.string(),
          outcome: z.string(),
          cause: z.string().nullable(),
          occurrences: z.number(),
          durationMs: z.number().nullable(),
          detail: z.string(),
        }),
      ),
      events: z.number(),
    }),
  },
};
