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
 */
const FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```/;

export function extractFencedMermaid(markdown) {
  if (typeof markdown !== "string") return null;
  const match = FENCE.exec(markdown);
  if (!match) return null;
  const source = match[1].trim();
  return source ? source : null;
}
