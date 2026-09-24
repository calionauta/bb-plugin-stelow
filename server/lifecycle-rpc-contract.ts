import { z } from "zod";
import { BOARD_MOVE_COLUMNS } from "../lib/tracks.mjs";
import { attachmentSchema, composerExecutionSchema } from "./contracts.js";

export const lifecycleRpcContract = {
  addCardComment: {
    experimental_description: "Comment on a card, scope, or task; the worker sees it",
    input: z
      .object({
        cardId: z.string(),
        target: z.enum(["card", "scope", "task"]),
        targetId: z.string(),
        body: z.string().min(1).max(10_000),
      })
      .strict(),
    output: z.object({ commentId: z.string(), error: z.string().nullable() }),
  },
  cancelCard: {
    experimental_description: "Stop the worker and archive the card; history preserved",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ archived: z.boolean() }),
  },
  deleteCard: {
    experimental_description: "Hard-delete an archived card, its rows, and its run files",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ deleted: z.boolean(), error: z.string().nullable() }),
  },
  discardPreview: {
    experimental_description: "Preview destroying unpushed work before archiving, blast radius first",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      eligible: z.boolean(),
      action: z.enum(["worktree-drop", "branch-reset", "dir-delete"]).nullable(),
      reason: z.string().nullable(),
      branch: z.string().nullable(),
      files: z.array(z.string()),
      fileCount: z.number(),
      commitCount: z.number(),
      sharedWith: z.number(),
      confirmTitle: z.string().nullable(),
      confirmBody: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  discardCardChanges: {
    experimental_description: "Destroy unpushed work, then archive; leaves an audit trail",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), summary: z.string().nullable(), error: z.string().nullable() }),
  },
  cleanupWorktreePreview: {
    experimental_description: "Preview removing a redundant linked worktree without archiving",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      eligible: z.boolean(),
      reason: z.string().nullable(),
      branch: z.string().nullable(),
      fileCount: z.number(),
      commitCount: z.number(),
      confirmTitle: z.string().nullable(),
      confirmBody: z.string().nullable(),
    }),
  },
  cleanupWorktree: {
    experimental_description: "Remove the linked worktree while keeping the card record",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), summary: z.string().nullable(), error: z.string().nullable() }),
  },
  reseedCard: {
    experimental_description: "Restart a card fresh from triage; scopes and comments kept",
    input: z
      .object({
        cardId: z.string(),
        presetId: z.string().nullable().optional(),
        intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).optional(),
      })
      .strict(),
    output: z.object({ reseeded: z.boolean(), error: z.string().nullable(), reclassified: z.boolean() }),
  },
  retryWorker: {
    experimental_description: "Nudge the same worker in place; nothing resets",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  restartWorker: {
    experimental_description: "Fresh worker thread on the current preset from the current stage",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  startWorker: {
    experimental_description: "Start a parked inbox card's worker",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  requestSplitProposal: {
    experimental_description: "Ask the worker for a one-time card-split proposal",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  moveCard: {
    experimental_description: "Move a card between board columns, Bucket rules enforced",
    input: z.object({ cardId: z.string(), status: z.enum(BOARD_MOVE_COLUMNS as [string, ...string[]]) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  researchStrategies: {
    experimental_description: "Research strategy catalog: labels, skills, keywords",
    input: z.object({}).strict(),
    output: z.object({
      strategies: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          skill: z.string(),
          blurb: z.string(),
          emoji: z.string(),
          keywords: z.array(z.string()),
        }),
      ),
    }),
  },
  createResearchCard: {
    experimental_description: "Create a research card and optionally start its worker",
    input: z
      .object({
        projectId: z.string(),
        environment: z.unknown(),
        prompt: z.string().min(1).max(20_000),
        attachments: z.array(attachmentSchema).max(20).default([]),
        strategy: z.string().min(1).max(60),
        presetId: z.string().nullable().optional(),
        start: z.boolean().default(true),
        execution: composerExecutionSchema.optional(),
      })
      .strict(),
    output: z.object({ cardId: z.string(), threadId: z.string().nullable() }),
  },
  createExploreCard: {
    experimental_description: "Create an explore card for one technique and optionally start it",
    input: z
      .object({
        projectId: z.string(),
        environment: z.unknown(),
        prompt: z.string().min(1).max(20_000),
        attachments: z.array(attachmentSchema).max(20).default([]),
        stageId: z.string().min(1).max(60),
        presetId: z.string().nullable().optional(),
        start: z.boolean().default(true),
        execution: composerExecutionSchema.optional(),
      })
      .strict(),
    output: z.object({ cardId: z.string(), threadId: z.string().nullable() }),
  },
  stageCatalog: {
    experimental_description: "Explore technique catalog: labels, skills, keywords",
    input: z.object({}).strict(),
    output: z.object({
      stages: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          skill: z.string(),
          emoji: z.string(),
          blurb: z.string(),
          keywords: z.array(z.string()),
        }),
      ),
    }),
  },
  researchIndex: {
    experimental_description: "Research index with ranked opportunities and round readiness",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      found: z.boolean(),
      indexPath: z.string().nullable(),
      content: z.string().nullable(),
      truncated: z.boolean(),
      opportunities: z.array(
        z.object({ id: z.string(), title: z.string(), checked: z.boolean(), group: z.string().nullable() }),
      ),
      rounds: z.array(
        z.object({
          n: z.number(),
          strategyId: z.string(),
          label: z.string(),
          emoji: z.string(),
          at: z.string(),
          status: z.enum(["ready", "pending", "missing"]),
          missing: z.array(z.string()),
          substeps: z.array(
            z.object({ slug: z.string(), status: z.enum(["ready", "missing", "invalid", "needs-depth"]) }),
          ),
          files: z.array(
            z.object({
              display: z.string(),
              path: z.string(),
              absolutePath: z.string(),
              hostId: z.string(),
              generatedAt: z.string(),
            }),
          ),
        }),
      ),
      error: z.string().nullable(),
    }),
  },
  fanOutResearch: {
    experimental_description: "Fan checked index opportunities out into build cards",
    input: z
      .object({ cardId: z.string(), opportunityIds: z.array(z.string().min(1).max(120)).min(1).max(20) })
      .strict(),
    output: z.object({
      ok: z.boolean(),
      created: z.array(z.object({ cardId: z.string(), title: z.string() })),
      error: z.string().nullable(),
    }),
  },
  cardDiff: {
    experimental_description: "Working-tree diff vs HEAD with entity and symbol summaries",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      found: z.boolean(),
      isRepo: z.boolean(),
      files: z.array(
        z.object({
          path: z.string(),
          display: z.string(),
          patch: z.string().nullable(),
          isNew: z.boolean(),
          absolutePath: z.string(),
          hostId: z.string(),
        }),
      ),
      truncated: z.boolean(),
      entitySummary: z
        .object({
          total: z.number(),
          fileCount: z.number(),
          added: z.number(),
          modified: z.number(),
          deleted: z.number(),
          renamed: z.number(),
          moved: z.number(),
          cosmeticOnly: z.boolean(),
        })
        .nullable(),
      changedSymbols: z
        .array(
          z.object({ symbol: z.string(), files: z.array(z.string()), callers: z.number(), testCallers: z.number() }),
        )
        .nullable(),
      error: z.string().nullable(),
    }),
  },
  auditTrailStatus: {
    experimental_description: "Audit-trail verification state for a build card",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      state: z.enum(["verified", "changed", "missing", "refused", "unsupported", "unavailable"]),
      detail: z.string().nullable(),
      head: z.string().nullable(),
      path: z.string().nullable(),
      contract: z.string().nullable(),
      recon: z.object({ state: z.enum(["recorded", "missing", "invalid"]), detail: z.string() }).nullable(),
    }),
  },
  runResearchStrategy: {
    experimental_description: "Run one more research strategy round on a card",
    input: z.object({ cardId: z.string(), strategy: z.string().min(1).max(60) }).strict(),
    output: z.object({ ok: z.boolean(), strategy: z.string().nullable(), error: z.string().nullable() }),
  },
  promoteCard: {
    experimental_description: "Turn an exploratory card into a real BB project, files in place",
    input: z.object({ cardId: z.string(), name: z.string().min(1).max(120) }).strict(),
    output: z.object({
      ok: z.boolean(),
      projectId: z.string().nullable(),
      projectName: z.string().nullable(),
      threadId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  answerExpiredQuestions: {
    experimental_description: "Answer timed-out questions from the card, all-or-nothing like live",
    input: z
      .object({
        cardId: z.string(),
        answers: z
          .array(
            z.object({
              questionId: z.string().min(1).max(200),
              answers: z.array(z.string().min(1).max(10_000)).min(1).max(20),
            }),
          )
          .min(1)
          .max(12),
      })
      .strict(),
    output: z.object({ ok: z.boolean(), answered: z.number(), error: z.string().nullable() }),
  },
  advanceCard: {
    experimental_description: "Advance a card to a stage preview under upstream transition rules",
    input: z.object({ cardId: z.string(), stage: z.string().min(1).max(40) }).strict(),
    output: z.object({ ok: z.boolean(), stdout: z.string(), error: z.string().nullable() }),
  },
  approveGate: {
    experimental_description: "Approve a review gate and write its receipt file",
    input: z
      .object({
        projectId: z.string().nullable(),
        workflowId: z.string(),
        gate: z.enum(["gate", "int-gate", "plan-gate", "diff-gate"]),
      })
      .strict(),
    output: z.object({ approved: z.boolean(), receiptPath: z.string().nullable(), error: z.string().nullable() }),
  },
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
