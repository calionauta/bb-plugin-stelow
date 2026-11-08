/**
 * Which pele diagram type represents each stelow artifact.
 *
 * The rule behind every row: an LLM never writes pele syntax directly. It
 * writes JSON or Markdown under a schema, a deterministic serializer derives
 * the diagram, and pele only renders. That is the breadboard precedent
 * (`breadboard.json` under `schemas/breadboard.json`, projected by
 * `scripts/breadboard-mermaid.mjs` with `DIAGRAM_KIND = "flowchart"`), and
 * every row below repeats it for its own artifact.
 *
 * This module is the single place the About panel and the artifact viewer
 * agree on: the pin, the links, and the per-artifact recommendation. Both
 * read these constants rather than restating them, so a pin bump cannot leave
 * one surface behind.
 */

export const PELE_PIN = "1.8.0";

export const PELE_REPO = "https://github.com/obsidianmd/pele";

export const PELE_HOMEPAGE = "https://pele.run";

export const PELE_PLAYGROUND = "https://pele.run/playground";

export const PELE_INSTALL = "npm install pele@1.8.0";

/**
 * The recommendation for one artifact path: which pele keywords to derive,
 * what the source of truth is, and whether the diagram is derived (never
 * hand-written).
 */
export function diagramForArtifact(path) {
  if (typeof path !== "string") return null;
  const clean = path.trim();
  if (!clean) return null;
  const base = clean.split("/").pop().toLowerCase();

  if (base === "breadboard.json") {
    return { kinds: ["flowchart"], source: "breadboard.json", derived: true };
  }
  if (base === "scope-map.json" || base === "scope-map-draft.json") {
    return { kinds: ["flowchart"], source: "scope-map.json", derived: true };
  }
  if (base === "selected-interface.md") {
    return { kinds: ["block-beta", "flowchart"], source: "selected-interface.md", derived: true };
  }
  if (clean.includes("interfaces/") && base.endsWith(".md")) {
    return { kinds: ["block-beta", "flowchart"], source: "interfaces/*.md", derived: true };
  }
  if (base.startsWith("spec-product")) {
    return { kinds: ["usecase-beta", "flowchart"], source: "spec-product.md", derived: true };
  }
  if (base.startsWith("spec-tech")) {
    return { kinds: ["flowchart", "swimlane-beta", "sequence"], source: "spec-tech.md", derived: true };
  }
  if (base === "selected-architecture.md" || base.startsWith("direction-") || base.startsWith("architecture")) {
    return { kinds: ["C4Component", "architecture-beta"], source: "architecture.md", derived: true };
  }
  if (base.endsWith(".mmd")) {
    return { kinds: ["flowchart"], source: "mermaid", derived: true };
  }
  return null;
}

/** Whether the path has a diagram recommendation at all. */
export function isDiagrammable(path) {
  return diagramForArtifact(path) !== null;
}

const PLAYGROUND_SOURCE_LIMIT = 4000;

/**
 * A pele playground link for a diagram source. Large sources fall back to the
 * bare playground: a truncated `#source=` fragment would render a broken
 * diagram presented as evidence, which is worse than no preload at all.
 */
export function pelePlaygroundUrl(source) {
  if (typeof source !== "string" || !source.trim()) return PELE_PLAYGROUND;
  if (source.length > PLAYGROUND_SOURCE_LIMIT) return PELE_PLAYGROUND;
  return `${PELE_PLAYGROUND}#source=${encodeURIComponent(source)}`;
}
