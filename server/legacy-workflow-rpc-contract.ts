import { z } from "zod";

/**
 * The cardless workflow entries (legacy): they seed and advance a workflow
 * without a card. Split out of the lifecycle contract so that file stays under
 * the 400-line budget. The object is spread back into it, so the wire shape and
 * every method key are unchanged.
 */
export const legacyWorkflowRpcContract = {
  startWorkflow: {
    experimental_description: "Start a cardless workflow thread (legacy entry)",
    input: z.object({ projectId: z.string(), prompt: z.string().min(1).max(20_000) }).strict(),
    output: z.object({ threadId: z.string() }),
  },
  advance: {
    experimental_description: "Advance a cardless workflow (legacy entry)",
    input: z.object({ projectId: z.string().nullable(), stage: z.string().min(1).max(40) }).strict(),
    output: z.object({ stage: z.string(), stdout: z.string(), error: z.string().nullable() }),
  },
  ensureWorkflow: {
    experimental_description: "Seed state files for a cardless workflow (legacy entry)",
    input: z
      .object({
        projectId: z.string().nullable(),
        name: z.string().min(1).max(120),
        intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate"]),
      })
      .strict(),
    output: z.object({
      rootPath: z.string().nullable(),
      statePath: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
};
