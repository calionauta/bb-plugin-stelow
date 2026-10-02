/**
 * How a document under decision is shown, decided by its path alone.
 *
 * Three kinds, and each is a different thing the reader must DO with it:
 *
 * - `markdown` — reasoning and decisions. Rendered as prose.
 * - `html` — a generated interface mockup. It has to be LOOKED AT; rendering
 *   its source is showing the reader the recipe instead of the dish, which is
 *   the whole gap this closes.
 * - `source` — anything else, read as code.
 *
 * The rule was inline in the viewer, as a `/\.mdx?$/` test, which meant the
 * one place that decides how evidence appears was the one place with no test.
 * A pure function is testable without a DOM, and the viewer becomes a switch
 * over its answer.
 *
 * The extension is the whole signal. It is deliberately not content sniffing:
 * a `.md` file whose first line is `<html>` is a document about HTML, and a
 * `.html` file that fails to parse is still the artifact the option named.
 */

/** Extensions whose content is a document to read. */
const MARKDOWN = /\.(md|mdx)$/i;

/**
 * Extensions that are a page to look at. `.htm` is the same format spelled
 * the other way, and a mockup written as either is the same evidence.
 */
const HTML = /\.(html|htm)$/i;

/** `"markdown" | "html" | "source"` — never null, so every caller has an answer. */
export function artifactRenderKind(path) {
  const clean = typeof path === "string" ? path.trim() : "";
  if (MARKDOWN.test(clean)) return "markdown";
  if (HTML.test(clean)) return "html";
  return "source";
}

/**
 * Whether a rendered page may be framed.
 *
 * A mockup is worker-authored and untrusted, so the sandbox withholds
 * `allow-same-origin`: combined with `allow-scripts` that is the one pairing
 * that lets a framed document reach its parent's origin, and the reader's bb
 * session lives there. Scripts stay allowed because an interactive mockup is
 * the evidence — a static screenshot of one is not the same claim.
 */
export const MOCKUP_SANDBOX = "allow-scripts";
