import { z } from "zod";
import { attachmentSchema, askOptionSchema, statusSchema } from "./contracts.js";
import { executionRunSchema } from "./execution-contract.js";

export const cardDetailRpcContract = {
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
          elapsedMs: z.number().nullable(),
        }),
        presetId: z.string(),
        workerPresetId: z.string().nullable(),
        presetRestartPending: z.boolean(),
        leadMs: z.number().nullable(),
        cycleMs: z.number().nullable(),
        doingNow: z.array(z.string()),
        executingScope: z.string().nullable(),
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
      // The approved scope map, drawn as a graph. A server projection and
      // nothing the card can write: the X-ray reports the map, the worker owns
      // the map. Null on a card with no approved map to draw.
      scopeXray: z
        .object({
          source: z.literal("server-projection"),
          mutable: z.literal(false),
          mapId: z.string(),
          mapVersion: z.string(),
          freshness: z.enum(["current", "stale", "unknown"]),
          nodes: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              capabilities: z.array(z.string()),
              state: z.enum(["current", "stale", "blocked", "unknown"]),
              provenance: z.array(z.string()),
            }),
          ),
          edges: z.array(
            z.object({
              from: z.string(),
              to: z.string(),
              kind: z.literal("depends-on"),
              state: z.enum(["current", "stale", "blocked", "unknown"]),
              provenance: z.array(z.string()),
            }),
          ),
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
      executionRuns: z.array(executionRunSchema),
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
