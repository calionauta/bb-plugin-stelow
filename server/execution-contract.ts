import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ensureExecutionRunTable } from "../lib/execution-run-ledger.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export function runExecutionMigrations(db: Db): void {
  ensureExecutionRunTable(db);
}

export const executionStateSchema = z.enum([
  "queued",
  "running",
  "needs_input",
  "succeeded",
  "failed",
  "cancelled",
]);

export const boundaryContractSchema = z.object({
  question: z.string(),
  questionId: z.string().nullable(),
  contractId: z.string(),
  boundaryId: z.string(),
  kind: z.enum(["reaction", "confirmation"]),
  status: z.enum(["open", "answered"]),
  shapeVersion: z.string(),
  scopeMapVersion: z.string().nullable(),
  answerSchema: z.unknown(),
}).nullable();

export const executionRunSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  runId: z.string().nullable(),
  recipeId: z.string(),
  stage: z.string(),
  sourceHash: z.string(),
  adapter: z.string(),
  workspaceId: z.string(),
  originThreadId: z.string(),
  nativeStatus: z.string().nullable(),
  normalizedStatus: executionStateSchema,
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  resumeOf: z.string().nullable(),
  errorCode: z.string().nullable(),
  previewDirective: z.string().nullable(),
  // The question a needs_input run is actually waiting on. A wait the
  // person cannot read is a phantom wait, so the run's own words travel
  // to the surface instead of a bare "Needs input" label.
  boundaryQuestion: z.string().nullable(),
  completionEventId: z.string().nullable(),
  boundaryContract: boundaryContractSchema,
  createdAt: z.number(),
});

export const executionRpcContract = defineRpcContract({
  startExecutionRun: {
    experimental_description: "Start a pinned native Workflows recipe through the card coordinator",
    input: z.object({
      cardId: z.string(),
      recipeId: z.string().regex(/^[a-z][a-z0-9-]*$/),
      context: z.object({
        prompt: z.string().min(1).max(20_000),
        intent: z.string().max(40).optional(),
        stage: z.string().max(40).optional(),
        reviewMode: z.string().max(80).optional(),
      }).strict(),
    }).strict(),
    output: z.object({
      ok: z.boolean(),
      run: executionRunSchema.nullable(),
      error: z.string().nullable(),
    }),
  },
  executionRuns: {
    experimental_description: "Native execution runs owned by a Stelow card",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ runs: z.array(executionRunSchema) }),
  },
  executionRunStatus: {
    experimental_description: "Normalized status and native identity for one execution run",
    input: z.object({ runId: z.string() }).strict(),
    output: z.object({
      run: executionRunSchema.nullable(),
      error: z.string().nullable(),
    }),
  },
  cancelExecutionRun: {
    experimental_description: "Cancel an active native run and keep the card answerable",
    input: z.object({ runId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      run: executionRunSchema.nullable(),
      error: z.string().nullable(),
    }),
  },
});
