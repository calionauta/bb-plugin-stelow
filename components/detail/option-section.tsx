import { Markdown } from "@get-bb/plugin-sdk/app";
import { optionSectionExcerpt } from "../../lib/option-anchor.mjs";

/**
 * The clicked option's own section, shown above the document it came from.
 *
 * A combined brief holds every proposal in one file, so opening it from an
 * option lands at the top — which is precisely not the option. On a real card
 * a reader opened the brief from "Hybrid A+C" and found proposals A and B:
 * the hybrid is the last section in the file, below three options they did not
 * pick. Scrolling cannot fix this, because the rendered headings carry no ids
 * to scroll to. Lifting the section answers the question actually being asked
 * — "what does THIS option say?" — while the full document stays below for
 * context and comparison.
 *
 * Renders nothing when the document has no section for the option. That is
 * deliberate: a wrong section under this option's name is worse than none.
 */
export function OptionSection({ content, optionLabel }: { content: string | null; optionLabel: string | undefined }) {
  if (content === null || !optionLabel) return null;
  const section = optionSectionExcerpt(content, optionLabel);
  if (section === null) return null;
  return (
    <section aria-label={`Your selection: ${optionLabel}`} className="rounded-md border-2 border-primary/50 bg-primary/5 p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
        Your selection · {optionLabel}
      </p>
      <div className="text-sm leading-relaxed">
        <Markdown content={`${section.heading}\n\n${section.body}`} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        From {section.heading} in this document (line {section.line}). The full document is below.
      </p>
    </section>
  );
}
