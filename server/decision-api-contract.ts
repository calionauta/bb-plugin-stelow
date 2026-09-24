import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const routeSchema = z.object({
  provider: z.string().nullable(),
  endpoint: z.string().nullable(),
  apiKey: z.string().nullable(),
  model: z.string().nullable(),
});
const routeInputSchema = z.object({
  provider: z.string().max(40).nullable().optional(),
  endpoint: z.string().max(500).nullable().optional(),
  apiKey: z.string().max(1000).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
}).strict();

export const decisionApiRpcContract = defineRpcContract({
  getDecisionApiConfig: {
    experimental_description: "Decision API endpoint, model, and key presence, never the key",
    input: z.object({}).strict(),
    output: z.object({
      endpoint: z.string(),
      model: z.string(),
      hasKey: z.boolean(),
      keySource: z.string().nullable(),
      keyRequired: z.boolean(),
      disabled: z.boolean(),
      provider: z.string(),
      configured: z.boolean(),
    }),
  },
  setDecisionApiConfig: {
    experimental_description: "Configure the shared decision endpoint, provider, key, and model",
    input: z
      .object({
        endpoint: z.string().max(500).nullable().optional(),
        apiKey: z.string().max(1000).nullable().optional(),
        model: z.string().max(120).nullable().optional(),
        provider: z.string().max(20).nullable().optional(),
      })
      .strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  testDecisionApi: {
    experimental_description: "Probe the decision endpoint with one fixed call and latency",
    input: z.object({}).strict(),
    output: z.object({
      ok: z.boolean(),
      latencyMs: z.number().nullable(),
      model: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  getDecisionPoint: {
    experimental_description: "One decision router's mode, thresholds, route override, and judge preset",
    input: z.object({ point: z.string() }).strict(),
    output: z.object({
      point: z.string(),
      mode: z.string(),
      thresholds: z.record(z.string(), z.number()),
      route: routeSchema.nullable(),
      presetId: z.string().nullable(),
    }),
  },
  listDecisionPoints: {
    experimental_description: "Every decision router with rules, modes, and current settings",
    input: z.object({}).strict(),
    output: z.object({
      points: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          description: z.string(),
          rules: z.string(),
          requires: z.string().nullable(),
          modes: z.array(z.string()),
          mode: z.string(),
          thresholds: z.record(z.string(), z.number()),
          route: routeSchema.nullable(),
          presetId: z.string().nullable(),
        }),
      ),
    }),
  },
  setDecisionPoint: {
    experimental_description: "Set a decision router's mode, thresholds, route override, and judge preset",
    input: z
      .object({
        point: z.string(),
        mode: z.string(),
        thresholds: z.record(z.string(), z.number()).optional(),
        route: routeInputSchema.nullable().optional(),
        presetId: z.string().max(200).nullable().optional(),
      })
      .strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getReviewPolicy: {
    experimental_description: "Independent-review gate policy: off or required",
    input: z.object({}).strict(),
    output: z.object({ mode: z.enum(["off", "required"]) }),
  },
  setReviewPolicy: {
    experimental_description: "Set the independent-review gate policy",
    input: z.object({ mode: z.enum(["off", "required"]) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
});
