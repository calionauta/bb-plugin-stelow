/**
 * Recovery is deliberately evidence-led. An agent mentioning a path is not
 * authority to move a card: it only makes an already registered BB project a
 * candidate that a person may inspect and explicitly attach.
 */
const REPORT_PREFIX = /(?:changes?\s+(?:are|were)\s+(?:uncommitted\s+)?in|(?:checkout|workspace|repository)\s+(?:is\s+)?(?:at|in))\s*[`'"]?(\/[^`'"\s,;]+)/gi;

export function reportedCheckoutPaths(...texts) {
  const found = new Set();
  for (const text of texts) {
    if (typeof text !== "string") continue;
    for (const match of text.matchAll(REPORT_PREFIX)) {
      const path = (match[1] ?? "").replace(/[.)\]]+$/, "");
      if (path.startsWith("/") && path.length > 1) found.add(path);
    }
  }
  return [...found];
}

// Patches and loose folders are evidence, never an instruction to copy or
// apply bytes. Capture only absolute paths explicitly present in this card's
// own worker output, then let the recovery UI make the evidence visible.
const ABSOLUTE_PATH = /(?:^|[\s`'"])(\/[^\s`'",;:)\]]+)/g;
const PATCH_FILE = /\.(?:patch|diff|bundle)$/i;

export function reportedRecoveryEvidence(...texts) {
  const found = new Map();
  for (const text of texts) {
    if (typeof text !== "string") continue;
    for (const match of text.matchAll(ABSOLUTE_PATH)) {
      const path = (match[1] ?? "").replace(/[.)\]]+$/, "");
      if (!path.startsWith("/") || path.length < 2) continue;
      found.set(path, { path, kind: PATCH_FILE.test(path) ? "patch" : "folder" });
    }
  }
  return [...found.values()];
}

/**
 * Stelow seeds every card workspace with its own scaffolding — `skills/`,
 * `data/`, `.stelow/`, and `stelow.json`. Counting those as "source material"
 * would classify every exploratory card as promotable and hide the
 * worker-reported-checkout path, so they are excluded by name. A real source
 * file, or a directory Stelow did not create, is what makes a folder a
 * project candidate.
 */
const SCAFFOLD_NAMES = new Set([".stelow", ".git", "skills", "data", "node_modules", "stelow.json"]);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|cs|vue|svelte|sh|css|scss|html|md|ya?ml|toml|sql)$/i;

export function hasWorkspaceSource(entries) {
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) => {
    const name = entry?.name;
    if (typeof name !== "string" || name.length === 0 || name.startsWith(".")) return false;
    if (SCAFFOLD_NAMES.has(name)) return false;
    if (entry.isDirectory) return true;
    return SOURCE_FILE.test(name);
  });
}

export function recoveryDisposition({ workspaceIsGit, hasWorkspaceSource, candidates, attached }) {
  if (attached) return "attached";
  if (workspaceIsGit || hasWorkspaceSource) return "promote";
  if (candidates.length === 1) return "external-project";
  if (candidates.length > 1) return "ambiguous";
  return "documents-only";
}

export function recoveryMessage(kind) {
  return {
    attached: "A registered project checkout is attached for review. The original exploratory workspace remains in the recovery record.",
    promote: "This exploratory workspace contains source material. It can be registered as its own project; files stay in place.",
    "external-project": "The worker reported changes in one registered project checkout. Review its live Git evidence before attaching it to this card.",
    ambiguous: "Several registered project checkouts match worker-reported paths. Choose only after comparing their Git evidence.",
    "documents-only": "This exploratory workspace contains workflow documents only. There is no evidenced code checkout to promote or attach.",
  }[kind];
}
