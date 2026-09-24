import { z } from "zod";

export const statusSchema = z.enum([
  "draft",
  "planning",
  "approved",
  "in-progress",
  "completed",
  "archived",
  "pending",
  "done",
  "skipped",
  "blocked",
  "escalated",
  "failed",
]);

export const appetiteSchema = z.enum(["Lean", "Core", "Complete"]);
export const reviewModeSchema = z.enum([
  "Auto",
  "Product Spec Gate",
  "Product Spec + Interface Gates",
  "Product Spec + Interface + Scopes",
  "Product Spec + Interface + Tech Review",
  "Product Spec + Interface + Tech Review + Code Diff",
]);
// Canonical storage is the gate set; legacy ladder strings are accepted
// and normalized on read through the compat map (lib/review-gates).
export const reviewGateAtomSchema = z.enum(["spec", "interface", "scope", "tech", "diff"]);
export const reviewModeInputSchema = z.union([reviewModeSchema, z.array(reviewGateAtomSchema)]).default("Auto");
export const boardWorkflowDefaultsSchema = z
  .object({ appetite: appetiteSchema, reviewMode: z.string(), reviewGates: z.array(reviewGateAtomSchema).default([]) })
  .strict();

export const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  status: statusSchema,
  source: z.string().optional(),
  note: z.string().optional(),
});

export const scopeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  type: z.string().optional(),
  status: statusSchema,
  source: z.string().optional(),
  gap: z.string().optional(),
  tasks: z.array(taskSchema),
});
export const artifactSchema = z.object({
  kind: z.enum(["product-spec", "interfaces", "tech-plan", "critique", "other"]),
  label: z.string(),
  path: z.string(),
  approved: z.boolean(),
});

export const attachmentSchema = z
  .object({
    path: z.string().min(1).max(4_000),
    type: z.enum(["localFile", "localImage"]),
  })
  .strict();

// What the user picked in the NewThreadComposer when opening a card. The
// composer's default* props are seeds only — every field stays changeable —
// so creation must carry the submitted choice instead of spawning the
// band/default preset. One schema shared by createCard, createResearchCard
// and createExploreCard; the merge rules live in lib/composer-execution.
export const composerExecutionSchema = z
  .object({
    providerId: z.string().min(1).max(60).optional(),
    model: z.string().min(1).max(120).optional(),
    reasoningLevel: z.string().min(1).max(20).optional(),
    permissionMode: z.enum(["accept-edits", "auto", "full"]).optional(),
    serviceTier: z.enum(["default", "fast"]).optional(),
    executionInputSources: z
      .object({
        providerId: z.enum(["explicit", "client-preference"]).optional(),
        model: z.enum(["explicit", "client-preference"]).optional(),
        reasoningLevel: z.enum(["explicit", "client-preference"]).optional(),
        permissionMode: z.enum(["explicit", "client-preference"]).optional(),
        serviceTier: z.enum(["explicit", "client-preference"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Ask option detail (mirrors the Option schema in
// orchestrator stages/ask-patterns.md): preview is the inline glance,
// artifact the openable source of truth. Both nullable so label-only
// options (and every historical row) keep working unchanged.
export const askArtifactSchema = z.object({
  path: z.string(),
  display: z.string(),
  absolutePath: z.string().nullable(),
  hostId: z.string().nullable(),
});
export const askOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
  preview: z.string().nullable(),
  artifact: askArtifactSchema.nullable(),
});

export const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: statusSchema,
  stage: z.string(),
  appetite: z.string(),
  reviewMode: z.string(),
  reviewGates: z.array(reviewGateAtomSchema),
  dirHash: z.string().optional(),
  cwd: z.string().optional(),
  phases: z.array(z.object({ id: z.string(), name: z.string(), status: statusSchema })),
  scopes: z.array(scopeSchema),
  artifacts: z.array(artifactSchema),
});

// BB-native self-update state. Displays ride along because git installs
// report commit shas as versions — the panel formats those, never raw shas.
export const pluginUpdateSchema = z.object({
  outcome: z.enum(["checking", "update-available", "current", "incompatible", "pinned", "unavailable"]),
  installed: z.string().nullable(),
  installedDisplay: z.string().nullable(),
  candidate: z.string().nullable(),
  candidateDisplay: z.string().nullable(),
  detail: z.string().nullable(),
  checkedAt: z.number().nullable(),
});

// Newest GitHub release known for installs BB cannot update (supplement to
// the BB verdict, never a competitor): shared by buildInfo and
// checkPluginUpdate so a forced re-check delivers both halves together.
export const githubReleaseSchema = z.object({
  tag: z.string(),
  url: z.string(),
  checkedAt: z.number(),
  newer: z.boolean(),
});
