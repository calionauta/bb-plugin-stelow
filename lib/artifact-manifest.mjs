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

/**
 * The one bar for "this path is a deliverable document", shared by every
 * surface that lists a state dir.
 *
 * The board and the card both read the same tree, so the bar lives here and
 * not in a caller's filter: a second copy of "not `state.md`, not a draft"
 * is how bookkeeping started rendering as a deliverable. Judge the path
 * relative to the state dir (the caller resolves it), so a workspace that
 * happens to sit under a `drafts/` parent is not emptied by this rule.
 */
export function isDeliverableArtifactPath(candidate) {
  if (typeof candidate !== "string" || !candidate) return false;
  const parts = candidate.replace(/\\/g, "/").split("/");
  const name = parts.pop() ?? "";
  if (!name.endsWith(".md") || STATE_BOOKKEEPING.test(name)) return false;
  return !parts.some((part) => DISPOSABLE_DIRS.has(part));
}

export function unregisteredArtifactPaths(allPaths, registeredPaths) {
  const registered = new Set(Array.isArray(registeredPaths) ? registeredPaths.filter((path) => typeof path === "string") : []);
  const seen = new Set();
  const result = [];
  for (const candidate of Array.isArray(allPaths) ? allPaths : []) {
    if (!isDeliverableArtifactPath(candidate)) continue;
    if (registered.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

/**
 * Every artifact the state registers, from EVERY `artifacts:` block.
 *
 * The manifest had two writers and two shapes: the helper writes it in the
 * state front-matter, and a host prompt tells the worker to append a block
 * of its own (the research and explore tracks have no `stelow advance` to
 * write it for them). The reader took the FIRST block and stopped, so a
 * worker's entry in a later block was invisible — and a second
 * `artifacts:` key is a duplicate key in YAML, which a parser may take the
 * first of, the last of, or refuse.
 *
 * So: read every block, wherever it is, and merge. One list, one reader.
 */
export function parseArtifactManifest(stateBlob) {
  const lines = String(stateBlob).split("\n");
  const artifacts = [];
  const seenPaths = new Set();
  let current = null;
  let inside = false;
  for (const line of lines) {
    if (line === "artifacts:") {
      if (current?.stage && current.path) artifacts.push(current);
      current = null;
      inside = true;
      continue;
    }
    // A new top-level key ends the block: the `history:` list looks exactly
    // like a manifest list, and reading it as one produced entries with no
    // path.
    if (inside && /^\S/.test(line)) {
      if (current?.stage && current.path) artifacts.push(current);
      current = null;
      inside = false;
    }
    if (!inside) continue;
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
  // The same path in two blocks is one artifact, not two.
  return artifacts.filter((artifact) => {
    if (seenPaths.has(artifact.path)) return false;
    seenPaths.add(artifact.path);
    return true;
  });
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

/** How many artifacts a trailer names. It reads the trailer it was handed
 * instead of re-deriving a number, so a surface that must phrase "nothing was
 * copied" cannot disagree with the count the worker will paste into the
 * commit. */
export function trailerArtifactCount(trailer) {
  return (Array.isArray(trailer) ? trailer : [])
    .filter((line) => String(line).startsWith("Stelow-Artifact:"))
    .length;
}

/**
 * Render the run-bundle `manifest.md` committed under docs/runs/<card-id>/.
 * Pure: the export handler supplies file names + content SHAs, this only
 * formats. Basenames stay stable (git history versions them); the SHA
 * column pins what this export contained. Missing entries are listed,
 * never hidden — an incomplete bundle must read incomplete.
 *
 * Two different facts live here, and they must not borrow each other's
 * number: `files` is what this export COPIED (with a SHA each), `registered`
 * is what `state.md` says the card produced. The trailer is derived from
 * `registered`, because the trailer is durable — someone reading the commit
 * in a year asks "what did this card produce", never "how many files could
 * the exporter read that evening". Deriving it from the copied subset printed
 * `Stelow-Artifacts: 0` over a bundle whose own `## Missing` section listed
 * seventeen registered artifacts.
 */
/**
 * The `## Tokens` section, with the figure's provenance stated.
 *
 * Extracted from `renderBundleManifest`, which crossed the repository's function budget
 * once the section learned to distinguish a measurement from an estimate.
 *
 * The wording follows the source, because most cards now carry estimates: only one of
 * four providers reports a token total and the rest report a context-window reading. A
 * line saying "provider-reported" over a sum of estimates is the same class of error as
 * printing 0 for an unknown total, which this file already refuses to do.
 */
function tokenSection(tokens) {
  const tokenLines = ["## Tokens", ""];
  const breakdown = tokens && typeof tokens === "object" && (tokens.total !== undefined || tokens.input !== undefined) ? tokens : null;
  const source = tokens && typeof tokens === "object" ? tokens.source ?? null : null;
  if (breakdown && typeof breakdown.total === "number") {
    const leg = (label, value) => (typeof value === "number" ? `${label} ${value.toLocaleString("en")}` : null);
    const legs = [
      leg("input", breakdown.input),
      leg("output", breakdown.output),
      leg("cached", breakdown.cached),
      leg("reasoning", breakdown.reasoning),
    ].filter((part) => part !== null);
    const attribution = source === "provider"
      ? "Provider-reported totals"
      : source === "context-estimate"
        ? "Totals estimated from the providers' context-window readings — not reported measurements"
        : "Totals from the card's worker threads, provenance not recorded";
    tokenLines.push(
      `${attribution} across the card's worker threads: ${breakdown.total.toLocaleString("en")} total`
        + `${legs.length > 0 ? ` (${legs.join(" · ")})` : ""}.`,
      ``,
    );
  } else {
    tokenLines.push("Unknown — no token reports at export time.", ``);
  }
  return tokenLines;
}

export function renderBundleManifest({ cardId, cardName, stage, generatedAt, files, missing, registered, gapTotals, tokens }) {
  const rows = (Array.isArray(files) ? files : [])
    .map((file) => `| ${file.name} | ${file.stage ?? "?"} | \`${file.sha8 ?? "????????"}\` | ${file.sourcePath} |`);
  const owner = Array.isArray(registered) ? registered : [];
  const count = owner.length === 0
    ? "0 registered in `state.md` — the trailer below names the card only."
    : `${owner.length} registered in \`state.md\` (${rows.length} copied) — the trailer counts the registration,`
      + " not the copy: an artifact that could not be read still counts.";
  const gaps = gapTotals && typeof gapTotals === "object"
    ? `${gapTotals.fixed ?? 0} fixed / ${gapTotals.documented ?? 0} documented / ${gapTotals.escalated ?? 0} escalated`
    : "no execution critique registered";
  const tokenLines = tokenSection(tokens);
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
    count,
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
  lines.push(`## Trailer (paste below the commit subject)`, ``, "```", ...buildArtifactTrailer(cardId, owner, gapTotals), "```", ``);
  return lines.join("\n");
}
