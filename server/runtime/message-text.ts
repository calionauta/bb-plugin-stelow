/**
 * Text as the card surface renders it.
 *
 * ::name{...} directives are bb's thread renderer syntax (the worker emits
 * ::stelow-artifact chips per produced file). Card comments are rendered as
 * plain Markdown, so the directive syntax is stripped there — the file names
 * it carried are already present as natural text in the same message.
 */
export function stripMessageDirectives(text: string | null): string {
  return String(text ?? "")
    .replace(/::[a-zA-Z0-9_-]+\{[^}]*\}/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
