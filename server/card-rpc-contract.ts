import { z } from "zod";
import {
  attachmentSchema,
  appetiteSchema,
  askOptionSchema,
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
  cardDetail: {
    experimental_description: "Full card picture: scopes, questions, artifacts, workers, Git state",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      card: z.object({
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
        presetOverridden: z.boolean(),
        updatedAt: z.number(),
        stallCount: z.number(),
        scopeSummary: z.object({
          scopesTotal: z.number(),
          scopesDone: z.number(),
          tasksTotal: z.number(),
          tasksDone: z.number(),
        }),
        presetId: z.string(),
        workerPresetId: z.string().nullable(),
        presetRestartPending: z.boolean(),
        leadMs: z.number().nullable(),
        cycleMs: z.number().nullable(),
        doingNow: z.array(z.string()),
        verifiedHeadSha: z.string().nullable(),
      }),
      attachments: z.array(
        attachmentSchema.extend({
          display: z.string(),
          relPath: z.string().nullable(),
          absolutePath: z.string(),
          hostId: z.string().nullable(),
        }),
      ),
      mentionedFiles: z.array(
        z.object({
          path: z.string(),
          display: z.string(),
          absolutePath: z.string(),
          hostId: z.string(),
          relPath: z.string().nullable(),
        }),
      ),
      scopes: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.literal("scope"),
          type: z.string().optional(),
          status: statusSchema,
          source: z.string().optional(),
          gap: z.string().optional(),
          blockedBy: z.array(z.string()).optional(),
          dependsOn: z.array(z.string()).optional(),
          record: z
            .object({
              verified: z.boolean().optional(),
              filesCount: z.number().optional(),
              commandsCount: z.number().optional(),
              completedAt: z.string().optional(),
              startedAt: z.string().optional(),
              suggestedCommit: z.string().optional(),
            })
            .optional(),
          startedAt: z.string().optional(),
          targetFiles: z.array(z.string()).optional(),
          contract: z
            .object({
              acceptanceCriteria: z.array(z.string()),
              verifyCommands: z.array(z.string()),
              targetFiles: z.array(z.string()),
            })
            .optional(),
          conditions: z.array(
            z.object({ type: z.string(), reason: z.string(), message: z.string(), observedAt: z.string() }),
          ),
          claimed: z.boolean().nullable(),
          tasks: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              kind: z.literal("task"),
              status: statusSchema,
              source: z.string().optional(),
              note: z.string().optional(),
              blockedBy: z.array(z.string()).optional(),
              dependsOn: z.array(z.string()).optional(),
              conditions: z.array(
                z.object({ type: z.string(), reason: z.string(), message: z.string(), observedAt: z.string() }),
              ),
            }),
          ),
        }),
      ),
      comments: z.array(
        z.object({
          id: z.string(),
          target: z.enum(["card", "scope", "task"]),
          targetId: z.string(),
          author: z.enum(["user", "agent"]),
          body: z.string(),
          createdAt: z.number(),
        }),
      ),
      pendingQuestions: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          question: z.string(),
          multiple: z.boolean(),
          kind: z.enum(["standard", "split"]),
          options: z.array(askOptionSchema),
          expiresAt: z.number().nullable(),
          staleness: z
            .object({
              docRevised: z.boolean(),
              docRemoved: z.boolean(),
              checkoutMoved: z.boolean(),
              commitCount: z.number(),
              touchedPaths: z.array(z.string()),
            })
            .nullable()
            .optional(),
        }),
      ),
      expiredQuestions: z.array(
        z.object({
          id: z.string(),
          question: z.string(),
          multiple: z.boolean(),
          kind: z.enum(["standard", "split"]),
          options: z.array(askOptionSchema),
          expiredAt: z.number(),
          staleness: z
            .object({
              docRevised: z.boolean(),
              docRemoved: z.boolean(),
              checkoutMoved: z.boolean(),
              commitCount: z.number(),
              touchedPaths: z.array(z.string()),
            })
            .nullable()
            .optional(),
        }),
      ),
      // Dumb-UI split flag: the card reads show/ok/reason, never
      // re-implements stage rules (single source: lib/split-proposal).
      splitAction: z.object({ show: z.boolean(), ok: z.boolean(), reason: z.string().nullable() }),
      stageSkips: z.object({
        offRoute: z.array(z.string()),
        skipped: z.array(z.object({ stage: z.string(), reason: z.string() })),
      }),
      // Scope-sync health: the spec file the writer parses against how many
      // scopes actually synced. Null on non-build cards; the panel reads the
      // state to name an untracked card instead of rendering it empty.
      scopeSync: z
        .object({
          state: z.enum(["ok", "no-spec", "no-blocks", "human-dialect", "unsynced"]),
          syncedScopes: z.number(),
          machineBlocks: z.number(),
          humanBlocks: z.number(),
          specFile: z.string().nullable(),
        })
        .nullable(),
      artifacts: z.array(
        z.object({
          stage: z.string(),
          kind: z.string(),
          role: z.enum(["deliverable", "evidence"]),
          path: z.string(),
          display: z.string(),
          generatedAt: z.string(),
          absolutePath: z.string(),
          hostId: z.string(),
          note: z.string().nullable().optional(),
        }),
      ),
      workerHistory: z.array(
        z.object({
          threadId: z.string(),
          presetName: z.string().nullable(),
          startedAt: z.number(),
          endedAt: z.number().nullable(),
          endedReason: z.string().nullable(),
          tokenUsage: z.number().nullable(),
          tokenBreakdown: z
            .object({
              input: z.number().nullable(),
              output: z.number().nullable(),
              cached: z.number().nullable(),
              reasoning: z.number().nullable(),
              total: z.number().nullable(),
            })
            .nullable(),
          children: z.array(
            z.object({
              threadId: z.string(),
              title: z.string().nullable(),
              status: z.string(),
              providerId: z.string().nullable(),
              tokenUsage: z.number().nullable(),
              tokenBreakdown: z
                .object({
                  input: z.number().nullable(),
                  output: z.number().nullable(),
                  cached: z.number().nullable(),
                  reasoning: z.number().nullable(),
                  total: z.number().nullable(),
                })
                .nullable(),
            }),
          ),
        }),
      ),
      // Environment of the worker thread: enables workspace-kind file links
      // (the official viewer with comments). Host-kind links fail for
      // exploratory workspaces, which live outside provisioned environments.
      fileEnvironmentId: z.string().nullable(),
      nextStages: z.array(z.string()),
      githubLink: z
        .object({
          repo: z.string(),
          number: z.number().int().positive(),
          url: z.string(),
          postedAt: z.number().nullable(),
        })
        .nullable(),
    }),
  },
};
