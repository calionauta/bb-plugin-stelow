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
