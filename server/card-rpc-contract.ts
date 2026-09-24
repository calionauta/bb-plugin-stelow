import { z } from "zod";
import {
  attachmentSchema,
  appetiteSchema,
  boardWorkflowDefaultsSchema,
  composerExecutionSchema,
  reviewModeInputSchema,
  statusSchema,
  workflowSchema,
} from "./contracts.js";

export const cardRpcContract = {
  board: {
    experimental_description: "Board workflows, stages, and GitHub status for one project",
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({
      rootPath: z.string().nullable(),
      workflows: z.array(workflowSchema),
      error: z.string().nullable(),
      githubStatus: z.object({
        ok: z.boolean(),
        pluginAvailable: z.boolean(),
        ghOk: z.boolean(),
        repos: z.array(z.object({ repo: z.string(), projectId: z.string().nullable() })),
      }),
      githubAutomationEnabled: z.boolean(),
    }),
  },
  projects: {
    experimental_description: "Projects BB knows, for board and card pickers",
    input: z.object({}).strict(),
    output: z.object({ projects: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  answerQuestions: {
    experimental_description: "Answer a card's live structured questions in one atomic submit",
    input: z
      .object({
        cardId: z.string(),
        answers: z
          .array(z.object({ questionId: z.string().min(1).max(200), answers: z.array(z.string().max(2_000)).max(10) }))
          .min(1)
          .max(12),
      })
      .strict(),
    output: z.object({ ok: z.boolean(), answered: z.number(), error: z.string().nullable() }),
  },
  listCards: {
    experimental_description: "Cards with status, worker state, and scope progress, optionally by track",
    input: z
      .object({
        projectId: z.string().nullable(),
        kind: z.enum(["build", "research", "explore"]).nullable().optional(),
      })
      .strict(),
    output: z.object({
      cards: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          displayName: z.string(),
          prompt: z.string(),
          intent: z.string(),
          projectId: z.string(),
          projectName: z.string(),
          workspaceKind: z.enum(["project", "exploratory"]),
          workspacePath: z.string().nullable(),
          environmentLabel: z.string().nullable(),
          kind: z.enum(["build", "research", "explore"]),
          researchStrategy: z.string().nullable(),
          researchStrategies: z.array(z.string()),
          exploreStage: z.string().nullable(),
          status: statusSchema,
          stage: z.string(),
          workerThreadId: z.string().nullable(),
          activity: z.enum(["idle", "running", "awaiting-answer", "error"]),
          lastError: z.string().nullable(),
          needsAttention: z.boolean(),
          hasPendingReview: z.boolean(),
          presetName: z.string().nullable(),
          presetProviderId: z.string().nullable(),
          presetModelId: z.string().nullable(),
          updatedAt: z.number(),
          stallCount: z.number(),
          scopeSummary: z.object({
            scopesTotal: z.number(),
            scopesDone: z.number(),
            tasksTotal: z.number(),
            tasksDone: z.number(),
          }),
          doingNow: z.array(z.string()),
        }),
      ),
    }),
  },
  cardByWorkerThread: {
    experimental_description: "Find the card that owns a worker thread",
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ cardId: z.string().nullable(), kind: z.enum(["build", "research", "explore"]).nullable() }),
  },
  readCardFile: {
    experimental_description: "Read a workspace file through the card's checkout",
    input: z.object({ cardId: z.string(), path: z.string().min(1).max(4_000) }).strict(),
    output: z.object({ content: z.string().nullable(), truncated: z.boolean(), error: z.string().nullable() }),
  },
  qualitySeal: {
    experimental_description: "Verification seal for an artifact path",
    input: z
      .object({
        cardId: z.string().nullable().optional(),
        threadId: z.string().nullable().optional(),
        path: z.string().min(1).max(4_000),
      })
      .strict(),
    output: z.object({
      status: z.enum(["verified", "hypothesis-only", "needs-revision", "unverified"]),
      failures: z.array(z.string()),
      evidence: z.string().nullable(),
      label: z.string().nullable(),
    }),
  },
  gapSummary: {
    experimental_description: "Execution-critique gaps: totals, pending scopes, lead and cycle time",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      matched: z.boolean(),
      total: z.number(),
      fixed: z.number(),
      documented: z.number(),
      escalated: z.number(),
      items: z.array(z.object({ description: z.string(), scopeStatus: z.string().nullable() })),
      pendingScopes: z.number(),
      unscoped: z.number(),
      leadMs: z.number().nullable(),
      cycleMs: z.number().nullable(),
      done: z.boolean(),
    }),
  },
  flowMetrics: {
    experimental_description: "Lead/cycle per finished card with p50/p90, plus stuck and review-awaiting now",
    input: z
      .object({
        projectId: z.string().nullable().optional(),
        since: z.number().int().nonnegative().nullable().optional(),
        until: z.number().int().nonnegative().nullable().optional(),
      })
      .strict(),
    output: z.object({
      items: z.array(
        z.object({
          cardId: z.string(),
          kind: z.enum(["build", "research", "explore"]),
          name: z.string(),
          leadMs: z.number().nullable(),
          cycleMs: z.number().nullable(),
          doneAt: z.number().nullable(),
        }),
      ),
      summary: z.object({
        count: z.number(),
        leadP50Ms: z.number().nullable(),
        leadP90Ms: z.number().nullable(),
        cycleP50Ms: z.number().nullable(),
        cycleP90Ms: z.number().nullable(),
      }),
      attention: z.array(
        z.object({
          cardId: z.string(),
          kind: z.enum(["build", "research", "explore"]),
          name: z.string(),
          reason: z.enum(["stuck", "review"]),
        }),
      ),
    }),
  },
  boardWorkflowDefaults: {
    experimental_description: "Board defaults: planning depth and review gates for new cards",
    input: z.object({}).strict(),
    output: boardWorkflowDefaultsSchema,
  },
  createCard: {
    experimental_description: "Create a build card and optionally start its triage worker",
    input: z
      .object({
        projectId: z.string(),
        environment: z.unknown(),
        prompt: z.string().min(1).max(20_000),
        attachments: z.array(attachmentSchema).max(20).default([]),
        intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).default("unknown"),
        appetite: appetiteSchema.default("Lean"),
        reviewMode: reviewModeInputSchema,
        presetId: z.string().nullable().optional(),
        start: z.boolean().default(true),
        execution: composerExecutionSchema.optional(),
      })
      .strict(),
    output: z.object({ cardId: z.string(), threadId: z.string().nullable() }),
  },
  updateCardIntent: {
    experimental_description: "Correct a build card's workflow type while it is still in triage",
    input: z
      .object({
        cardId: z.string(),
        intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]),
      })
      .strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  renameCard: {
    experimental_description: "Rename a card's display title (1-120 chars); blank restores the heuristic",
    input: z.object({ cardId: z.string(), name: z.string().max(120) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
};
