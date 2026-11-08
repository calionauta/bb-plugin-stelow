/**
 * Which diagram, if any, the viewer derives for one artifact file.
 *
 * One function owns the whole decision so the viewer stays a switch: the file
 * extension decides the KIND (`artifact-render`), the mapping decides whether
 * the kind carries a diagram (`diagram-strategy`), and the derivation below
 * produces the Mermaid source — deterministically from JSON, or from an
 * authored fence in Markdown gated by the renderer at view time.
 *
 * Three origins, each with its own honesty rule:
 *
 * - `file` (`.mmd`): the source IS the file. No derivation, no staleness.
 * - `scope-map` (`scope-map.json`, drafts): derived from the parsed map via
 *   `scopeMapToFlowchart`. A map that does not parse, or a DAG the serializer
 *   refuses (dangling dependency, id collision), reads as source — a refused
 *   map must never become a pretty picture of something else.
 * - `fence` (diagrammable Markdown with a ```mermaid block): the authored
 *   block, rendered only if the renderer accepts it. The prose stays beside
 *   it either way.
 *
 * `breadboard.json` deliberately derives NOTHING here: its canonical views
 * (`.mmd`/`.html` from the upstream renderer) already exist beside it, and a
 * second serializer would eventually disagree with the first.
 */
import { artifactRenderKind } from "./artifact-render.mjs";
import { diagramForArtifact } from "./diagram-strategy.mjs";
import { scopeMapToFlowchart } from "./scope-map-diagram.mjs";
import { extractFencedMermaid } from "./fenced-mermaid.mjs";

const SCOPE_MAP_SOURCE = "scope-map.json";

export function derivedDiagram(path, content, options) {
  if (options && options.truncated) return null;
  if (typeof content !== "string" || !content) return null;
  const kind = artifactRenderKind(path);
  if (kind === "mermaid") {
    return {
      mermaid: content,
      caption: "Derived diagram source — the JSON or Markdown beside it is the source of truth.",
    };
  }
  const recommendation = diagramForArtifact(path);
  if (!recommendation) return null;
  if (kind === "source" && recommendation.source === SCOPE_MAP_SOURCE) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    try {
      return {
        mermaid: scopeMapToFlowchart(parsed),
        caption: "Derived from the Scope Map — the map is the source of truth.",
      };
    } catch {
      return null;
    }
  }
  if (kind === "markdown") {
    const fenced = extractFencedMermaid(content);
    if (!fenced) return null;
    return {
      mermaid: fenced,
      caption: "Authored diagram — it renders only when the renderer accepts it.",
    };
  }
  return null;
}
