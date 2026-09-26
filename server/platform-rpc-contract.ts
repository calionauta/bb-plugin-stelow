import { z } from "zod";
import { PREVIEW_STATES } from "../lib/preview-session.mjs";
import { githubReleaseSchema, pluginUpdateSchema, workflowDependencyStatusSchema } from "./contracts.js";

export const platformRpcContract = {
  listPresets: {
    experimental_description: "Agent presets: provider, model, reasoning, permission, environment",
    input: z.object({}).strict(),
    output: z.object({
      presets: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          providerId: z.string(),
          modelId: z.string(),
          reasoningLevel: z.string(),
          permissionMode: z.string(),
          environmentKind: z.string(),
          baseBranch: z.string().nullable(),
          machineId: z.string().nullable(),
          instructions: z.string(),
          isDefault: z.boolean(),
          builtIn: z.boolean(),
        }),
      ),
    }),
  },
  upsertPreset: {
    experimental_description: "Create or update an agent preset; built-ins protected",
    input: z
      .object({
        id: z.string().min(1).nullable().optional(),
        name: z.string().min(1).max(60),
        providerId: z.string().min(1).max(60),
        modelId: z.string().min(1).max(120),
        reasoningLevel: z.string().min(1).max(20),
        permissionMode: z.enum(["accept-edits", "auto", "full"]),
        environmentKind: z.enum(["project-default", "new-worktree"]).default("project-default"),
        baseBranch: z.string().nullable().optional(),
        machineId: z.string().nullable().optional(),
        instructions: z.string().max(8_000).default(""),
      })
      .strict(),
    output: z.object({ preset: z.object({ id: z.string(), name: z.string() }) }),
  },
  deletePreset: {
    experimental_description: "Delete a custom agent preset",
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ deleted: z.boolean(), error: z.string().nullable() }),
  },
  listBandPresets: {
    experimental_description: "Per-phase worker preset routing with stage lists",
    input: z.object({}).strict(),
    output: z.object({
      bands: z.array(z.object({ band: z.string(), presetId: z.string().nullable(), stages: z.array(z.string()) })),
    }),
  },
  setBandPreset: {
    experimental_description: "Pin a preset to a workflow band; null inherits",
    input: z.object({ band: z.string(), presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getReviewPreset: {
    experimental_description: "Designated independent reviewer preset, if any",
    input: z.object({}).strict(),
    output: z.object({
      preset: z
        .object({
          id: z.string(),
          name: z.string(),
          providerId: z.string(),
          modelId: z.string(),
          reasoningLevel: z.string(),
          permissionMode: z.string(),
        })
        .nullable(),
    }),
  },
  assignReviewPreset: {
    experimental_description: "Designate the reviewer preset; null clears",
    input: z.object({ presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getGenerationPreset: {
    experimental_description: "Designated draft-generation preset, if any",
    input: z.object({}).strict(),
    output: z.object({
      preset: z
        .object({
          id: z.string(),
          name: z.string(),
          providerId: z.string(),
          modelId: z.string(),
          reasoningLevel: z.string(),
          permissionMode: z.string(),
        })
        .nullable(),
    }),
  },
  assignGenerationPreset: {
    experimental_description: "Designate the draft-generation preset; null clears",
    input: z.object({ presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  getReliablePreset: {
    experimental_description: "Board-level reliable-tier preset override, if any",
    input: z.object({}).strict(),
    output: z.object({
      preset: z
        .object({
          id: z.string(),
          name: z.string(),
          providerId: z.string(),
          modelId: z.string(),
          reasoningLevel: z.string(),
          permissionMode: z.string(),
        })
        .nullable(),
    }),
  },
  assignReliablePreset: {
    experimental_description: "Set the reliable-tier preset override; null clears",
    input: z.object({ presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  assignPreset: {
    experimental_description: "Pin a preset to one card; takes effect on restart",
    input: z.object({ cardId: z.string(), presetId: z.string().nullable() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  setDefaultPreset: {
    experimental_description: "Set the board default agent preset",
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  listProviderModels: {
    experimental_description: "BB provider catalog with model availability for preset pickers",
    input: z.object({}).strict(),
    output: z.object({
      providers: z.array(z.object({ id: z.string(), displayName: z.string(), modelsAvailable: z.boolean() })),
      models: z.array(z.object({ providerId: z.string(), model: z.string(), displayName: z.string() })),
    }),
  },
  buildInfo: {
    experimental_description: "Plugin and upstream versions, skills, and update verdicts",
    input: z.object({}).strict(),
    output: z.object({
      version: z.string(),
      builtAt: z.string().nullable(),
      stelowVersion: z.string().nullable(),
      skills: z.array(z.string()),
      pluginUpdate: pluginUpdateSchema,
      githubRelease: githubReleaseSchema.nullable(),
    }),
  },
  applyPluginUpdate: {
    experimental_description: "Apply a BB-offered plugin update behind explicit confirmation",
    input: z.object({}).strict(),
    output: z.object({
      applied: z.boolean(),
      outcome: z.enum(["rolled-back", "current", "updated", "unavailable"]),
      detail: z.string().nullable(),
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
  },
  checkPluginUpdate: {
    experimental_description: "Force a fresh plugin update check: BB plus GitHub release",
    input: z.object({}).strict(),
    output: z.object({ pluginUpdate: pluginUpdateSchema, githubRelease: githubReleaseSchema.nullable() }),
  },
  aboutLogo: {
    experimental_description: "Product identity mark as a data URI; BB serves no static files",
    input: z.object({}).strict(),
    output: z.object({ dataUri: z.string().nullable() }),
  },
  toolStatus: {
    experimental_description: "Host binaries the workflow can use: sem, cymbal, ripwire, ast-grep",
    input: z.object({}).strict(),
    output: z.object({
      tools: z.array(z.object({ id: z.string(), present: z.boolean(), version: z.string().nullable() })),
    }),
  },
  installTool: {
    experimental_description: "Install one optional host tool with the official installer",
    input: z.object({ id: z.enum(["sem", "ast-grep", "cymbal", "ripwire"]) }).strict(),
    output: z.object({ ok: z.boolean(), version: z.string().nullable(), log: z.string() }),
  },
  workflowDependencyStatus: {
    experimental_description: "Report whether BB Workflows is installed, enabled, and available for Stelow execution",
    input: z.object({}).strict(),
    output: workflowDependencyStatusSchema,
  },
  installWorkflowDependency: {
    experimental_description: "Install the built-in BB Workflows plugin on explicit user request",
    input: z.object({}).strict(),
    output: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      status: workflowDependencyStatusSchema,
    }),
  },
  enableWorkflowDependency: {
    experimental_description: "Enable the installed BB Workflows plugin on explicit user request",
    input: z.object({}).strict(),
    output: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      status: workflowDependencyStatusSchema,
    }),
  },
  previewState: {
    experimental_description: "Dev-server preview state: address, command, log, share hints",
    input: z.object({ cardId: z.string(), appOrigin: z.string().nullable().optional() }).strict(),
    output: z.object({
      available: z.boolean(),
      error: z.string().nullable(),
      checkout: z.string().nullable(),
      source: z.string().nullable(),
      label: z.string().nullable(),
      evidence: z.string().nullable(),
      state: z.enum([...PREVIEW_STATES]),
      command: z.string().nullable(),
      port: z.number().nullable(),
      url: z.string().nullable(),
      provider: z.string().nullable(),
      reason: z.string().nullable(),
      frame: z.enum(["frame", "open", "copy"]).nullable(),
      frameReason: z.string().nullable(),
      paired: z.boolean(),
      hints: z.array(
        z.object({
          tone: z.enum(["info", "warn"]),
          text: z.string(),
          action: z.string().nullable(),
          href: z.string().nullable(),
        }),
      ),
      log: z.string(),
      startedAt: z.number().nullable(),
    }),
  },
  previewStart: {
    experimental_description: "Start the card workspace's dev server on loopback",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  previewStop: {
    experimental_description: "Stop the card workspace's dev server",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  previewShare: {
    experimental_description: "Retry the Connect share URL for a live preview",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
};
