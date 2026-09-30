import { z } from "zod";
import { EXPOSURE_REASONS } from "../lib/shared-checkout-exposure.mjs";
import { attachmentSchema, askOptionSchema, statusSchema } from "./contracts.js";
import { executionRunSchema } from "./execution-contract.js";

/**
 * A boundary question's framing. Resolved from the `[Stelow boundary <id>]`
 * marker against the run's boundary contract, then shaped in lib/ — the card
 * renders `showOptions` and the copy, and never re-derives the rule.
 */
const boundaryShapeSchema = z.object({
  kind: z.enum(["reaction", "confirmation"]),
  showOptions: z.boolean(),
  heading: z.string(),
  notice: z.string().nullable(),
});

export const cardDetailRpcContract = {
  /**
   * The cross-thread half of "who is in this card's files".
   *
   * A SEPARATE call, and the reason is cost. Answering it needs a
   * `bb thread list --json` (~0.6s) and a `git status` of the checkout, and
   * a card's spawn environment is `project-default` for every host without a
   * New-worktree preset — so folding this into `cardDetail` would put a
   * subprocess on the open-card path for a section that starts closed and that
   * most readers never open. Asked when the reader asks.
   *
   * A managed worktree answers `isolated` without a subprocess at all, because
   * isolation is the reason there is nothing to report.
   */
  sharedCheckoutExposure: {
    experimental_description: "Other BB threads sharing this card's checkout, and which of its held files are dirty there",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      isolated: z.boolean(),
      threads: z.number(),
      files: z.array(z.string()),
      lines: z.array(z.string()),
      // One list, owned by lib/: a reason the schema does not know cannot be
      // returned, and a reason with no schema cannot have a sentence.
      reason: z.enum(EXPOSURE_REASONS),
    }),
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
          // The files themselves, not a tally: which files this card holds,
          // and which of its scope's files another live card holds. Null
          // `claimed` with empty lists means the card has no state dir to
          // read claims from, which is not the same as holding nothing.
          claimFiles: z.array(z.string()),
          blockedFiles: z.array(
            z.object({ file: z.string(), heldBy: z.string(), expiresAt: z.number() }),
          ),
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
          // A boundary question's framing, decided in lib/ from the boundary's
          // `kind` and sent whole so the card renders instead of
          // re-implementing the rule. Null for an ordinary question.
          boundary: boundaryShapeSchema.nullable(),
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
      // Who else holds this card's files, asked on purpose rather than
      // reported after a collision. Derived from the claim ledger the lock
      // protocol already enforces, so it adds no new state and no new rule.
      // `isolated` says why the answer is empty on a managed worktree:
      // nothing can reach those files, and saying nothing is the honest
      // answer rather than a silent one.
      fileOccupancy: z.object({
        isolated: z.boolean(),
        lines: z.array(z.string()),
        shared: z.number(),
      }),
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
      // Which of this card's files another live card holds, derived from the
      // same enriched scopes the card renders. Null when nothing is blocked —
      // the hero reads it to say WHY it is idle instead of the generic
      // "unfinished work" that is true of every stalled card.
      fileLocks: z
        .object({
          files: z.array(z.string()),
          holders: z.array(z.string()),
          holderCardId: z.string(),
          holderName: z.string(),
          // True when the holder is a sibling scope of this same card: still
          // contention, but not a card the reader can go and unblock.
          internal: z.boolean(),
          expiresAt: z.number(),
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
