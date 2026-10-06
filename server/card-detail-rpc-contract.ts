import { z } from "zod";
import { EXPOSURE_REASONS } from "../lib/shared-checkout-exposure.mjs";
import {
  attachmentSchema,
  askOptionSchema,
  boundaryShapeSchema,
  cardStatusSchema,
  scopeSummarySchema,
  tokenBreakdownSchema,
  trackableStatusSchema,
} from "./contracts.js";
import { executionRunSchema } from "./execution-contract.js";
import { scopeDraftSchema, scopeXraySchema } from "./scope-xray-contract.js";

/**
 * A boundary question's framing. Resolved from the `[Stelow boundary <id>]`
 * marker against the run's boundary contract, then shaped in lib/ — the card
 * renders `showOptions` and the copy, and never re-derives the rule.
 */
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
  /**
   * Whether the verify failure parking this card is still the failure to act
   * on: the last test run's HEAD versus the checkout's HEAD now.
   *
   * A SEPARATE call, like `sharedCheckoutExposure` above and for the same
   * reason — the answer costs a subprocess, and most cards never show the
   * notice. Asked when the reader is looking at a decision hero.
   */
  verifyBlockage: {
    experimental_description: "Whether a verify failure blocking this card is stale: last test run HEAD versus checkout HEAD now",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      state: z.enum(["clear", "stale", "confirmed", "unknown"]),
      exitCode: z.number().nullable(),
      runHeadSha: z.string().nullable(),
      currentHeadSha: z.string().nullable(),
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
        status: cardStatusSchema,
        stage: z.string(),
        workerThreadId: z.string().nullable(),
        activity: z.enum(["idle", "running", "awaiting-answer", "error", "held"]),
        lastError: z.string().nullable(),
        // The host-read latch (lib/host-read-streak.mjs). Null whenever the host
        // is answering. Deliberately not `activity`: a transport fault is not a
        // verdict, and `last_error` would turn it into a Resume button.
        readMissSince: z.number().nullable(),
        // The host's hold, with its sentence already derived. Null whenever the
        // thread is free, so a consumer reads one nullable rather than
        // re-deriving the reason from the kind.
        hostHold: z.object({
          kind: z.enum(["capacity", "offline", "permission", "scheduled", "queued"]),
          holderId: z.string().nullable(),
          reason: z.string().nullable(),
          queued: z.number(),
          summary: z.string().nullable(),
        }).nullable(),
        // The native Workflows run that owns this card's stage, with its
        // sentence already derived. Null when no run is live. A card running a
        // multi-hour workflow is `running` on a thread that never turns again,
        // so this is what tells a reader the work is elsewhere and moving —
        // the same split hostHold makes, for the same reason.
        nativeRun: z.object({
          id: z.string(),
          normalizedStatus: z.enum(["queued", "running", "needs_input"]),
          recipeId: z.string(),
          stage: z.string(),
          stageLabel: z.string().nullable(),
          summary: z.string().nullable(),
        }).nullable(),
        // The failed run holding this card at its CURRENT stage, or null. The
        // card is told which run blocks rather than re-deriving the rule, so
        // the Retry button it offers and the refusal the advance returns cannot
        // disagree about which run is the one. Scoped to the stage on purpose:
        // a card carries failed runs for every stage it has passed, and only
        // one of them is holding this one.
        blockingRun: z.object({
          id: z.string(),
          recipeId: z.string(),
          errorCode: z.string().nullable(),
        }).nullable(),
        needsAttention: z.boolean(),
        hasPendingReview: z.boolean(),
        integrationPending: z.object({
          state: z.enum(["unpublished", "local", "unmerged"]),
          label: z.string(),
          detail: z.string(),
        }).nullable(),
        // The human acceptance receipt, or null when nobody has recorded one.
        // A stamp and nothing else: the host SDK has no operator identity, so
        // a name here would be free text wearing attribution's clothes
        // (lib/card-acceptance.mjs).
        acceptedAt: z.number().nullable(),
        // The disposition line a reader sees, derived where the receipt lives.
        // Null whenever there is no receipt, so the surface reads one nullable
        // rather than re-deriving the sentence.
        acceptanceLine: z.string().nullable(),
        presetName: z.string().nullable(),
        presetProviderId: z.string().nullable(),
        presetModelId: z.string().nullable(),
        presetOverridden: z.boolean(),
        updatedAt: z.number(),
        stallCount: z.number(),
        scopeSummary: scopeSummarySchema,
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
          status: trackableStatusSchema,
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
              status: trackableStatusSchema,
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
      scopeXray: scopeXraySchema.nullable(),
      // The draft map preview for the gate review. Present only when no
      // approved map exists, so a draft never competes with the real map.
      scopeDraft: scopeDraftSchema.nullable(),
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
          // The provenance of `tokenUsage`, and it has to cross the RPC boundary or
          // the UI cannot tell an estimate from a measurement: a zod object strips
          // undeclared keys, so the field travelled all the way here and was
          // silently dropped, leaving every row labelled "provider-reported".
          tokenUsageSource: z.enum(["provider", "context-estimate"]).nullable(),
          tokenBreakdown: tokenBreakdownSchema,
          children: z.array(
            z.object({
              threadId: z.string(),
              title: z.string().nullable(),
              status: z.string(),
              providerId: z.string().nullable(),
              tokenUsage: z.number().nullable(),
              tokenBreakdown: tokenBreakdownSchema,
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
