import { isAbsolute, relative, resolve, sep } from "node:path";

const ARTIFACT_FIELDS = new Set(["stage", "kind", "label", "path"]);

/**
 * Resolve only a manifest path that is explicitly relative to the project.
 * Artifact manifests are agent-produced input, so never let them name an
 * absolute file or traverse out of the workspace.
 */
export function resolveArtifactPath(projectRoot, artifactPath) {
  if (typeof projectRoot !== "string" || typeof artifactPath !== "string" || !artifactPath.trim()) return null;
  if (isAbsolute(artifactPath)) return null;
  if (artifactPath.split(/[\\/]+/).some((segment) => segment === "..")) return null;
  try {
    const root = resolve(projectRoot);
    const fullPath = resolve(root, artifactPath);
    const fromRoot = relative(root, fullPath);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
    return fullPath;
  } catch {
    return null;
  }
}

/**
 * Card inventory may expose an artifact only after it has reviewable content.
 * This intentionally differs from stage-completion checks: a short real note
 * can be useful, but blank placeholders must never render as documents.
 */
export function isPublishableArtifactContent(content) {
  return typeof content === "string" && content.trim().length > 0;
}

/**
 * Documents the workflow wrote but never registered in state.md.
 *
 * The audit trail must not depend on an agent remembering to declare its own
 * output: a produced artifact that was never registered would otherwise be
 * invisible on the card. `.md` is the same bar the board's `findArtifacts`
 * uses, so the card and the board agree on what counts as a document; the
 * workflow's own state is bookkeeping, not an artifact.
 */
const STATE_BOOKKEEPING = /^state\.md(\.bak|$)/;
// Disposable Tier G drafts: worker-judged scratch, never deliverables. They
// are recorded via the draft comment + thread output, so neither the card's
// unregistered list nor the strict audit gate may trip on them (a draft
// burst must never block done).
const DISPOSABLE_DIRS = new Set(["drafts"]);

export function unregisteredArtifactPaths(allPaths, registeredPaths) {
  const registered = new Set(Array.isArray(registeredPaths) ? registeredPaths.filter((path) => typeof path === "string") : []);
  const seen = new Set();
  const result = [];
  for (const candidate of Array.isArray(allPaths) ? allPaths : []) {
    if (typeof candidate !== "string" || !candidate) continue;
    const parts = candidate.replace(/\\/g, "/").split("/");
    const name = parts.pop() ?? "";
    if (!name.endsWith(".md") || STATE_BOOKKEEPING.test(name)) continue;
    if (parts.some((part) => DISPOSABLE_DIRS.has(part))) continue;
    if (registered.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

export function parseArtifactManifest(stateBlob) {
  const lines = String(stateBlob).split("\n");
  const start = lines.findIndex((line) => line === "artifacts:");
  if (start < 0) return [];

  const artifacts = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const item = line.match(/^  - ([a-z_]+):\s*(.+)$/);
    const field = line.match(/^    ([a-z_]+):\s*(.+)$/);
    if (item && ARTIFACT_FIELDS.has(item[1])) {
      if (current?.stage && current.path) artifacts.push(current);
      current = { [item[1]]: item[2].trim() };
    } else if (field && current && ARTIFACT_FIELDS.has(field[1])) {
      current[field[1]] = field[2].trim();
    }
  }
  if (current?.stage && current.path) artifacts.push(current);
  return artifacts;
}

/**
 * Paste-ready commit-message trailer block naming the card's registered
 * artifacts. Git commits cannot carry file attachments and hosting UIs
 * show no git-notes, so this trailer is the durable audit link between
 * a commit and the Stelow run that produced it.
 */
export function buildArtifactTrailer(cardId, artifacts, gapTotals = null) {
  const entries = (Array.isArray(artifacts) ? artifacts : [])
    .filter((entry) => entry && typeof entry.path === "string" && entry.path.length > 0);
  const trailer = [
    `Stelow-Card: ${cardId}`,
    `Stelow-Artifacts: ${entries.length}`,
    ...entries.map((entry) => `Stelow-Artifact: [${entry.stage ?? "?"}] ${entry.path}`),
  ];
  if (gapTotals && typeof gapTotals === "object") {
    trailer.push(`Stelow-Gaps: ${gapTotals.fixed ?? 0} fixed / ${gapTotals.documented ?? 0} documented / ${gapTotals.escalated ?? 0} escalated`);
  }
  return trailer;
}

/**
 * Render the run-bundle `manifest.md` committed under docs/runs/<card-id>/.
 * Pure: the export handler supplies file names + content SHAs, this only
 * formats. Basenames stay stable (git history versions them); the SHA
 * column pins what this export contained. Missing entries are listed,
 * never hidden — an incomplete bundle must read incomplete.
 */
export function renderBundleManifest({ cardId, cardName, stage, generatedAt, files, missing, gapTotals, tokens }) {
  const rows = (Array.isArray(files) ? files : [])
    .map((file) => `| ${file.name} | ${file.stage ?? "?"} | \`${file.sha8 ?? "????????"}\` | ${file.sourcePath} |`);
  const gaps = gapTotals && typeof gapTotals === "object"
    ? `${gapTotals.fixed ?? 0} fixed / ${gapTotals.documented ?? 0} documented / ${gapTotals.escalated ?? 0} escalated`
    : "no execution critique registered";
  // Token evidence is optional and honest: provider-reported totals across
  // the card's worker threads at export time, committed with the bundle so
  // cost questions have a git-blameable answer. No reports reads unknown.
  const tokenLines = ["## Tokens", ""];
  const breakdown = tokens && typeof tokens === "object" ? tokens : null;
  if (breakdown && typeof breakdown.total === "number") {
    const leg = (label, value) => (typeof value === "number" ? `${label} ${value.toLocaleString("en")}` : null);
    const legs = [leg("input", breakdown.input), leg("output", breakdown.output), leg("cached", breakdown.cached), leg("reasoning", breakdown.reasoning)].filter((part) => part !== null);
    tokenLines.push(
      `Provider-reported totals across the card's worker threads: ${breakdown.total.toLocaleString("en")} total${legs.length > 0 ? ` (${legs.join(" · ")})` : ""}.`,
      ``,
    );
  } else {
    tokenLines.push(`Unknown — no provider token reports at export time.`, ``);
  }
  const lines = [
    `# Run bundle — ${cardName} (${cardId})`,
    ``,
    `Exported ${generatedAt} at stage \`${stage}\`. Commit this directory with the work so the run stays navigable from git history; per-commit versioning comes from git log, not subdirectories.`,
    ``,
    `## Files`,
    ``,
    `| File | Stage | SHA-8 | Source |`,
    `|------|-------|-------|--------|`,
    ...rows,
    ``,
    `## Gaps`,
    ``,
    gaps,
    ``,
    ...tokenLines,
  ];
  const missingRows = (Array.isArray(missing) ? missing : []);
  if (missingRows.length > 0) {
    lines.push(`## Missing (registered but unreadable at export)`, ``, ...missingRows.map((path) => `- ${path}`), ``);
  }
  lines.push(`## Trailer (paste below the commit subject)`, ``, "```", ...buildArtifactTrailer(cardId, (files ?? []).map((file) => ({ stage: file.stage, path: file.sourcePath })), gapTotals), "```", ``);
  return lines.join("\n");
}
