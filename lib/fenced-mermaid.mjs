/**
 * First fenced ```mermaid block in a Markdown artifact, if any.
 *
 * Prose artifacts (spec-tech, architecture directions, interface proposals)
 * have no machine contract to project deterministically, so their diagram
 * path is authoring + validation instead of derivation: a worker may carry
 * ONE fenced mermaid block, and the viewer renders it only when the bundled
 * renderer accepts it (`supports()` at view time, `render()` try/catch).
 * Anything else — no fence, or a fence the renderer refuses — reads as prose
 * or source, never as a broken picture. A hand-typed diagram that cannot
 * render is evidence about the fence, not about the artifact.
 *
 * `splitFencedMermaid` keeps the prose around the fence. A question preview
 * may be a diagram plus a sentence that says what it shows; dropping the
 * sentence to show the picture would discard authored evidence to gain a
 * few pixels of layout.
 */
const FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```/;

export function splitFencedMermaid(markdown) {
  if (typeof markdown !== "string") return null;
  const match = FENCE.exec(markdown);
  if (!match) return null;
  const source = match[1].trim();
  if (!source) return null;
  const prose = `${markdown.slice(0, match.index)}${markdown.slice(match.index + match[0].length)}`.trim();
  return { source, prose };
}

export function extractFencedMermaid(markdown) {
  return splitFencedMermaid(markdown)?.source ?? null;
}
