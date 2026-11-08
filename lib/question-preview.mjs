/**
 * How an option's `--preview` is shown under the option.
 *
 * Two shapes, and the worker chooses by what it writes:
 *
 * - a fenced ```mermaid block is a diagram, rendered by the same viewer the
 *   brief uses. ASCII is a wireframe's source, not its picture; a diagram is
 *   the one preview that can be read as evidence without decoding box-drawing
 *   characters.
 * - anything else is a text wireframe, kept verbatim in a monospace block.
 *
 * The distinction lives here, not in the component, so the rule is testable
 * without a DOM and the option row stays a switch over the answer.
 */
import { splitFencedMermaid } from "./fenced-mermaid.mjs";

export function previewShape(preview) {
  if (typeof preview !== "string") return null;
  const text = preview.trim();
  if (!text) return null;
  const fenced = splitFencedMermaid(text);
  if (fenced) {
    return { kind: "mermaid", source: fenced.source, prose: fenced.prose };
  }
  return { kind: "text", text };
}
