import { z } from "zod";
import {
  attachmentSchema,
  appetiteSchema,
  boardWorkflowDefaultsSchema,
  composerExecutionSchema,
  explorationCountSchema,
  qualitySchema,
  redFirstSchema,
  reviewModeInputSchema,
  cardStatusSchema,
  scopeSummarySchema,
  supervisorSchema,
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
        // Optional, not merely nullable. `queryCards` omits the project filter
        // when this is null, so the handler genuinely answers "every project"
        // — but a non-optional property is what the host's schema derivation
        // reports as REQUIRED, so a caller that omitted it (the host's own
        // plugin probe) was refused at validation for a call the handler
        // supports. `.nullable()` said the value could be absent; only
        // `.optional()` makes that true of the published contract too.
        projectId: z.string().nullable().optional(),
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
          status: cardStatusSchema,
          stage: z.string(),
          workerThreadId: z.string().nullable(),
          activity: z.enum(["idle", "running", "awaiting-answer", "error", "held"]),
          lastError: z.string().nullable(),
          // When the host stopped answering this card's state read. Carried
          // beside `activity`, never inside it: a card whose reads are failing
          // keeps the projection it was last verified on, and this is the only
          // thing on the tile that says the projection is no longer fresh.
          readMissSince: z.number().nullable(),
          needsAttention: z.boolean(),
          hasPendingReview: z.boolean(),
          integrationPending: z.object({
            state: z.enum(["unpublished", "local", "unmerged"]),
            label: z.string(),
            detail: z.string(),
          }).nullable(),
          presetName: z.string().nullable(),
          presetProviderId: z.string().nullable(),
          presetModelId: z.string().nullable(),
          updatedAt: z.number(),
          stallCount: z.number(),
          scopeSummary: scopeSummarySchema,
          doingNow: z.array(z.string()),
          executingScope: z.string().nullable(),
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
      items: z.array(z.object({ description: z.string(), resolution: z.string(), scopeStatus: z.string().nullable() })),
      pendingScopes: z.number(),
      unscoped: z.number(),
      leadMs: z.number().nullable(),
      cycleMs: z.number().nullable(),
      done: z.boolean(),
      // The per-round findings, so the card can show rework without the metric
      // being re-derived in the UI. Empty when no critique is matched, which the
      // rework owner reads as "not measured" rather than "nothing reworked".
      rounds: z.array(z.array(z.object({ description: z.string(), resolution: z.string() }))),
      // The card's review coverage, already parsed, so the UI reads the same
      // numbers the CLI and the flow strip do. Empty means "no readable
      // reviews", which the owner reads as not-measured rather than "all whole".
      reviews: z.array(z.object({
        excerpt: z.object({
          selected: z.string(),
          truncated: z.boolean(),
          sentChars: z.number().nullable(),
          originalChars: z.number().nullable(),
        }),
      })),
    }),
  },
  flowMetrics: {
    experimental_description: "Lead/cycle per finished card with p50/p90, where the time went, plus stuck and review-awaiting now",
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
          // Where the card's wall-clock went, split by cause and never summed
          // across overlapping windows. `unattributedMs` is the honest residual:
          // time the data does not explain, never time claimed as work.
          wait: z.object({
            totalMs: z.number(),
            humanMs: z.number(),
            systemMs: z.number(),
            attributedMs: z.number(),
            unattributedMs: z.number(),
            humanShare: z.number(),
            systemShare: z.number(),
            unattributedShare: z.number(),
          }),
          reviewWaitMs: z.number().nullable(),
        }),
      ),
      summary: z.object({
        count: z.number(),
        leadP50Ms: z.number().nullable(),
        leadP90Ms: z.number().nullable(),
        cycleP50Ms: z.number().nullable(),
        cycleP90Ms: z.number().nullable(),
      }),
      wait: z.object({
        totalMs: z.number(),
        humanMs: z.number(),
        systemMs: z.number(),
        unattributedMs: z.number(),
        humanShare: z.number(),
        systemShare: z.number(),
        unattributedShare: z.number(),
      }),
      // The two readings that need the files a card left behind, summed over
      // the finished cards in scope. Read outside `flow-metrics` because that
      // function is pure over the ledger, and a workspace is not the ledger.
      // `rate` is null until a second round exists anywhere in scope.
      coverage: z.object({
        rework: z.object({
          cardsWithRounds: z.number(),
          comparable: z.number(),
          reworked: z.number(),
          rate: z.number().nullable(),
          descriptions: z.array(z.string()),
        }),
        reviews: z.object({
          counted: z.number(),
          truncated: z.number(),
          headCuts: z.number(),
        }),
        // Rendered by the same lib owners the CLI and the card call.
        reworkLine: z.string(),
        coverageLine: z.string(),
      }),
      attention: z.array(
        z.object({
          cardId: z.string(),
          kind: z.enum(["build", "research", "explore"]),
          name: z.string(),
          reason: z.enum(["stuck", "review"]),
          // How long a finished card has been waiting for a look. Null on stuck
          // cards, whose own age lives in the card hero instead.
          waitMs: z.number().nullable(),
        }),
      ),
    }),
  },
  boardWorkflowDefaults: {
    experimental_description: "Board defaults: run knobs and review gates for new cards",
    input: z.object({}).strict(),
    output: boardWorkflowDefaultsSchema,
  },
  createCard: {
    experimental_description: "Create a build card and optionally start its triage worker",
    input: z
      .object({
        projectId: z.string(),
        // Optional, not merely unconstrained. `selectCardEnvironment` returns
        // the workspace's own environment whenever the request is absent or
        // unrecognised, so every creator genuinely answers "the project
        // default" — but a non-optional property is what the host's schema
        // derivation reports as REQUIRED. The host's plugin probe omits it and
        // was refused at validation for a call the handler supports, which
        // surfaced as "rpc createCard failed" on the plugin's own status line:
        // the one place a person looks to see whether a plugin is healthy.
        environment: z.unknown().optional(),
        prompt: z.string().min(1).max(20_000),
        attachments: z.array(attachmentSchema).max(20).default([]),
        intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).default("unknown"),
        quality: qualitySchema.default("production"),
        supervisor: supervisorSchema.default("high"),
        explorationCount: explorationCountSchema.default(3),
        redFirst: redFirstSchema.optional(),
        /** Deprecated alias; when present without knobs it maps once to knobs. */
        appetite: appetiteSchema.optional(),
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
  updateCardPrompt: {
    experimental_description: "Edit a parked card's description (up to 20000 chars after trim); refused once started, completed, or archived",
    // No .max() here on purpose: the handler trims before measuring, so a
    // padded-but-legal input must pass the contract and reach the handler's
    // ERR_PROMPT_TOO_LONG only when the trimmed text is actually over-long.
    input: z.object({ cardId: z.string(), prompt: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  updateCardWorkspace: {
    experimental_description: "Move a parked empty card to another project/checkout (gated)",
    input: z.object({ cardId: z.string(), projectId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  acceptCard: {
    experimental_description: "Record a human acceptance of a finished card's result; a receipt, never a gate",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      // The stamp the receipt carries, or null when nothing was written. The
      // host SDK exposes no operator identity, so this is the whole receipt
      // (lib/card-acceptance.mjs).
      acceptedAt: z.number().nullable(),
    }),
  },
  draftDoneComment: {
    experimental_description: "Draft a GitHub completion note with the cheap generation preset",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      draft: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  catchUp: {
    experimental_description: "What changed on a card since the reader last looked: deterministic facts, optionally phrased",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      /** `last-read` when a read is the anchor, `created` when the card has
       * never been opened — the surface says which rather than implying
       * "caught up" for a card nobody has looked at. */
      anchor: z.enum(["last-read", "created"]).nullable(),
      since: z.number().nullable(),
      summary: z.string().nullable(),
      facts: z.array(
        z.object({
          kind: z.enum(["stage", "question", "answer", "blocked", "resumed", "error", "completed"]),
          at: z.number(),
          text: z.string().nullable(),
          stage: z.string().nullable(),
          open: z.boolean().nullable(),
        }),
      ),
      /** The model's phrasing of the facts, or null when it was unavailable,
       * disabled, or produced nothing usable. Never a fact of its own. */
      prose: z.string().nullable(),
      source: z.string().nullable(),
    }),
  },
};
