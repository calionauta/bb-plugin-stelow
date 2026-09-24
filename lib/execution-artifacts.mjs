export function safeArtifactPath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.split("/").includes("..") && !value.includes("\0");
}

function taskIsActive(task, context = {}) {
  if (task.when === "always" || !task.when) return true;
  if (task.when === "appetite_supports_fanout") return ["Core", "Complete"].includes(context.appetite);
  if (task.when === "partition_is_safe") return context.partitionSafe === true;
  if (task.when === "ui_scope_present") return context.uiScopePresent === true;
  return true;
}

export function requiredOutputPaths(recipe, context = {}) {
  return [...new Set((recipe?.tasks ?? []).filter((task) => taskIsActive(task, context)).map((task) => task.output).filter(safeArtifactPath))];
}

function schemaIssue(value, schema, path = "$") {
  if (!schema || typeof schema !== "object") return null;
  if (schema.enum && !schema.enum.includes(value)) return `${path} is not an allowed value`;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
    for (const key of schema.required ?? []) if (!(key in value)) return `${path}.${key} is required`;
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) {
      const issue = schemaIssue(value[key], child, `${path}.${key}`);
      if (issue) return issue;
    }
    if (schema.additionalProperties === false) {
      const extra = Object.keys(value).find((key) => !(key in (schema.properties ?? {})));
      if (extra) return `${path}.${extra} is not allowed`;
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (schema.minItems && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} items`;
    if (schema.items) value.forEach((item, index) => { const issue = schemaIssue(item, schema.items, `${path}[${index}]`); if (issue) throw new Error(issue); });
  } else if (schema.type === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
    if (schema.minLength && value.length < schema.minLength) return `${path} is too short`;
  } else if (schema.type === "boolean" && typeof value !== "boolean") return `${path} must be a boolean`;
  return null;
}

function semanticOutputIssue(path, value) {
  if (path.includes("verification") && value.passed === true && value.checks?.some((check) => check.status === "failed")) return "passed verification cannot contain failed checks";
  if (path.includes("scope") && value.status === "verified" && (value.scopes?.length === 0 || value.claims?.some((claim) => claim.status !== "released"))) return "verified scope output requires completed scopes and released claims";
  return null;
}

export function validateExecutionArtifacts({ recipe, contents, context = {} }) {
  const missing = [];
  const malformed = [];
  for (const path of requiredOutputPaths(recipe, context)) {
    const content = contents?.[path];
    if (typeof content !== "string" || !content.trim()) {
      missing.push(path);
      continue;
    }
    if (path.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        const task = recipe.tasks?.find((candidate) => candidate.output === path);
        const schemaIssueValue = schemaIssue(parsed, task?.output_schema_contract);
        if (schemaIssueValue || semanticOutputIssue(path, parsed)) malformed.push(path);
      } catch {
        malformed.push(path);
      }
    }
  }
  return { ok: missing.length === 0 && malformed.length === 0, missing, malformed, paths: requiredOutputPaths(recipe, context) };
}

export function executionArtifactManifest({ run, recipe, contents }) {
  return {
    recipeId: recipe.id,
    taskId: run.id,
    runId: run.runId,
    stage: run.stage,
    outputs: requiredOutputPaths(recipe).map((path) => ({ path, taskId: recipe.tasks.find((task) => task.output === path)?.id ?? null, sha256: null, present: typeof contents?.[path] === "string" && contents[path].trim().length > 0 })),
  };
}
